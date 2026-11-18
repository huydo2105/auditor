import { createServer } from "node:http";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DEMO_PROGRAM, fixtureRevisionMatches, publicProgram } from "./program.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const json = (res, code, value) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(value));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const equalToken = (given, expected) => {
  if (typeof given !== "string" || typeof expected !== "string" || !given.startsWith("Bearer ")) return false;
  const a = Buffer.from(sha(given.slice(7)));
  const b = Buffer.from(sha(expected));
  return timingSafeEqual(a, b);
};
async function readBody(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw fail(415, "JSON body required");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw fail(413, "request too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw fail(400, "invalid JSON"); }
}
function validBody(kind, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort().join();
  if (kind === "scan") return keys === "artifactFormat,target" && body.artifactFormat === "repo-fixture-v1"
    && body.target === "local-vaults";
  return keys === "artifactFormat,fixture" && body.artifactFormat === "repo-fixture-v1"
    && ["vulnerable", "patched"].includes(body.fixture);
}
export function executeJob(kind, body) {
  return new Promise((resolveJob, rejectJob) => {
    const worker = new Worker(resolve(here, "job-worker.mjs"), { workerData: { kind, body },
      resourceLimits: { maxOldGenerationSizeMb: 64 } });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectJob(error); else resolveJob(value);
    };
    const timer = setTimeout(() => { worker.terminate(); finish(new Error("job deadline exceeded")); }, 150_000);
    worker.once("message", data => data.ok ? finish(null, data.value) : finish(new Error(data.error)));
    worker.once("error", error => finish(error));
    worker.once("exit", code => { if (!settled) finish(new Error(`worker exited ${code}`)); });
  });
}
export function createApiServer({ token, teamToken, researcherToken, invitedResearcherIds = DEMO_PROGRAM.invitedResearcherIds,
  execute = executeJob, now = Date.now, maxJobs = 16 } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("VERIPOC_API_TOKEN must be at least 32 characters");
  const configured = [teamToken, researcherToken].filter(value => value !== undefined);
  if (configured.some(value => typeof value !== "string" || value.length < 32)
    || (configured.length && (configured.length !== 2 || new Set([token, teamToken, researcherToken]).size !== 3)))
    throw new Error("distinct VERIPOC_TEAM_TOKEN and VERIPOC_RESEARCHER_TOKEN of at least 32 characters are required together");
  const jobs = new Map();
  const idempotency = new Map();
  const submissions = new Map();
  let programRuns = 0;
  const buckets = new Map();
  let running = false;
  const queue = [];
  const pump = () => {
    if (running || !queue.length) return;
    running = true;
    const job = queue.shift();
    job.state = "running";
    Promise.resolve().then(() => {
      if (job.programId && !fixtureRevisionMatches()) throw new Error("reviewed fixture revision changed before execution");
      return execute(job.kind, job.body);
    }).then(result => {
      if (job.programId && ["reproduced", "not_reproduced"].includes(result.status)
        && result.receipt?.input?.sourceSha256 !== DEMO_PROGRAM.workerInputSha256)
        throw new Error("worker image does not match reviewed program inputs");
      job.state = "finished";
      job.result = result;
    }).catch(error => {
      job.state = "finished";
      job.result = { status: "tool_error", reason: String(error.message || error) };
    }).finally(() => { running = false; pump(); });
  };
  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    res.setHeader("content-security-policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'");
    if (req.method === "GET" && path === "/.well-known/agent-card.json") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
        "x-content-type-options": "nosniff" });
      res.end(readFileSync(resolve(here, "../../.well-known/agent-card.json")));
      return;
    }
    if (!path.startsWith("/v1/")) return json(res, 404, { error: "not found" });
    const isProgram = path.startsWith("/v1/programs/");
    const actor = equalToken(req.headers.authorization, teamToken) && teamToken ? { id: DEMO_PROGRAM.ownerId, role: "team" }
      : equalToken(req.headers.authorization, researcherToken) && researcherToken ? { id: DEMO_PROGRAM.invitedResearcherIds[0], role: "researcher" } : null;
    if (isProgram ? !actor : !equalToken(req.headers.authorization, token)) return json(res, 401, { error: "unauthorized" });
    const key = `${req.socket.remoteAddress}:${req.method === "POST" ? "write" : "read"}`;
    const limit = req.method === "POST" ? (isProgram ? 20 : 5) : 120;
    const bucket = buckets.get(key);
    const current = now();
    const next = !bucket || current - bucket.start >= 60_000 ? { start: current, count: 0 } : bucket;
    next.count++;
    buckets.set(key, next);
    if (next.count > limit) return json(res, 429, { error: "rate limit exceeded" });
    try {
      if (isProgram) {
        const segments = path.split("/").slice(3);
        if (segments[0] !== DEMO_PROGRAM.id) return json(res, 404, { error: "program not found" });
        if (actor.role === "researcher" && !invitedResearcherIds.includes(actor.id))
          return json(res, 403, { error: "not invited" });
        if (req.method === "GET" && segments.length === 1)
          return json(res, 200, { program: publicProgram(programRuns), actor });
        if (req.method === "GET" && segments.length === 2 && segments[1] === "submissions")
          return json(res, 200, { submissions: [...submissions.values()].filter(item => actor.role === "team" || item.authorId === actor.id) });
        if (req.method === "GET" && segments.length === 3 && segments[1] === "jobs") {
          const job = jobs.get(segments[2]);
          if (!job || job.programId !== DEMO_PROGRAM.id || (actor.role !== "team" && job.authorId !== actor.id))
            return json(res, 404, { error: "job not found" });
          return json(res, 200, { id: job.id, programId: job.programId, submissionId: job.submissionId,
            actorId: job.authorId, kind: job.kind, state: job.state, fixture: job.body.fixture, result: job.result });
        }
        if (req.method !== "POST") return json(res, 404, { error: "not found" });
        if (actor.role !== "researcher") return json(res, 403, { error: "researcher role required" });
        if (!fixtureRevisionMatches()) return json(res, 409, { error: "reviewed fixture revision changed" });
        const requestKey = req.headers["idempotency-key"];
        if (typeof requestKey !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(requestKey)) throw fail(400, "valid Idempotency-Key required");
        const body = await readBody(req);
        const isSubmission = segments.length === 2 && segments[1] === "submissions";
        const isRun = segments.length === 4 && segments[1] === "submissions" && segments[3] === "jobs";
        if (!isSubmission && !isRun) return json(res, 404, { error: "not found" });
        const submission = isRun ? submissions.get(segments[2]) : null;
        if (isRun && (!submission || submission.programId !== DEMO_PROGRAM.id || submission.authorId !== actor.id))
          return json(res, 404, { error: "submission not found" });
        const action = isSubmission ? "submission" : `run:${submission.id}`;
        const scopedKey = `${DEMO_PROGRAM.id}:${actor.id}:${action}:${requestKey}`;
        const fingerprint = sha(JSON.stringify([DEMO_PROGRAM.id, actor.id, action, body]));
        const prior = idempotency.get(scopedKey);
        if (prior) return prior.fingerprint === fingerprint ? json(res, isSubmission ? 201 : 202,
          isSubmission ? submissions.get(prior.id) : { id: prior.id, state: jobs.get(prior.id).state })
          : json(res, 409, { error: "idempotency key reused for a different request" });
        if (isSubmission && (!body || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).sort().join() !== "claim,targetSha256"
          || body.claim !== "donation-share-inflation" || body.targetSha256 !== DEMO_PROGRAM.targetSha256))
          throw fail(400, "only the reviewed vault claim and target revision are accepted");
        if (isRun && !validBody("verify", body)) throw fail(400, "only reviewed repository fixtures are accepted");
        if (isSubmission) {
          const item = { id: randomUUID(), programId: DEMO_PROGRAM.id, authorId: actor.id,
            claim: body.claim, targetSha256: body.targetSha256, jobIds: [] };
          submissions.set(item.id, item);
          idempotency.set(scopedKey, { fingerprint, id: item.id });
          return json(res, 201, item);
        }
        if (programRuns >= DEMO_PROGRAM.runLimit) throw fail(429, "program run limit reached");
        if (jobs.size >= maxJobs) throw fail(503, "job capacity reached; restart local server after reviewing results");
        const job = { id: randomUUID(), programId: DEMO_PROGRAM.id, authorId: actor.id,
          submissionId: submission.id, kind: "verify", body, state: "queued", result: null };
        jobs.set(job.id, job);
        submission.jobIds.push(job.id);
        programRuns++;
        idempotency.set(scopedKey, { fingerprint, id: job.id });
        queue.push(job);
        pump();
        return json(res, 202, { id: job.id, state: job.state });
      }
      if (req.method === "GET" && /^\/v1\/jobs\/[a-f0-9-]{36}$/.test(path)) {
        const job = jobs.get(path.slice(9));
        return job && !job.programId ? json(res, 200, { id: job.id, kind: job.kind, state: job.state,
          fixture: job.body.fixture ?? null, result: job.result ?? null }) : json(res, 404, { error: "job not found" });
      }
      const kind = path === "/v1/scan" ? "scan" : path === "/v1/verify-poc" ? "verify" : null;
      if (req.method !== "POST" || !kind) return json(res, 404, { error: "not found" });
      const requestKey = req.headers["idempotency-key"];
      if (typeof requestKey !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(requestKey)) throw fail(400, "valid Idempotency-Key required");
      const body = await readBody(req);
      if (!validBody(kind, body)) throw fail(400, "only reviewed repository fixtures are accepted");
      const fingerprint = sha(JSON.stringify([kind, body]));
      const prior = idempotency.get(requestKey);
      if (prior) return prior.fingerprint === fingerprint ? json(res, 202, { id: prior.id, state: jobs.get(prior.id).state })
        : json(res, 409, { error: "idempotency key reused for a different request" });
      if (jobs.size >= maxJobs) throw fail(503, "job capacity reached; restart local server after reviewing results");
      const job = { id: randomUUID(), kind, body, state: "queued", result: null };
      jobs.set(job.id, job);
      idempotency.set(requestKey, { fingerprint, id: job.id });
      queue.push(job);
      pump();
      return json(res, 202, { id: job.id, state: job.state });
    } catch (error) {
      return json(res, error.status ?? 500, { error: error.status ? error.message : "internal error" });
    }
  });
}
