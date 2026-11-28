import { createServer } from "node:http";
import { timingSafeEqual, createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { DEMO_PROGRAM, fixtureRevisionMatches, publicProgram } from "./program.mjs";
import { authorizeAgentRequest, lookupConcordiumAgent, pruneExpiredNonces } from "./agent-auth.mjs";
import { createWalletAuthStore, formatClearSessionCookie, formatSessionCookie } from "./wallet-auth.mjs";
import { createProgramStore } from "./program-store.mjs";
import { generateAgentSetup, validateAgentSetupInput } from "./agent-setup.mjs";
import { buildInboxPayload, validateAdvisoryNote, validateTriageDecision } from "./triage.mjs";
import { createConcordiumAnchorService } from "../../packages/core/concordium-anchor.mjs";
import { receiptHash } from "../../packages/core/receipt.mjs";
import { buildPaymentTerms, DEFAULT_X402_CAP, verifyConcordiumTestnetTx, verifyX402Payment } from "./x402.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");
const json = (res, code, value, extraHeaders = {}) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", ...extraHeaders });
  res.end(JSON.stringify(value));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const programForMember = (item, account, badge) => ({ ...item,
  invitedResearcherAccounts: account ? [account] : [], invitedAgentBadges: badge ? [badge] : [] });
const publicProgramView = item => ({ id: item.id, name: item.name, ownerAccount: item.ownerAccount,
  sourceUrl: item.sourceUrl, sourceRevision: item.sourceRevision, chain: item.chain,
  visibility: "public", status: item.status, verification: item.verification,
  permittedTargets: item.permittedTargets, rules: item.rules, exclusions: item.exclusions,
  agentContext: item.agentContext, docsUrl: item.docsUrl, references: item.references,
  rewardCurrency: item.rewardCurrency, rewardTiers: item.rewardTiers, runLimit: item.runLimit });
const equalToken = (given, expected) => {
  if (typeof given !== "string" || typeof expected !== "string" || !given.startsWith("Bearer ")) return false;
  const a = Buffer.from(sha(given.slice(7)));
  const b = Buffer.from(sha(expected));
  return timingSafeEqual(a, b);
};
async function readBody(req, maxSize = 4096) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw fail(415, "JSON body required");
  const raw = await readRawBody(req, maxSize);
  try { return JSON.parse(raw.toString("utf8")); }
  catch { throw fail(400, "invalid JSON"); }
}
async function readRawBody(req, maxSize = 4096) {
  if (req.rawBody) return req.rawBody;
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxSize) throw fail(413, "request too large");
    chunks.push(chunk);
  }
  req.rawBody = Buffer.concat(chunks);
  return req.rawBody;
}
function validStructuredReport(report) {
  if (!report || typeof report !== "object" || Array.isArray(report)) return false;
  const required = ["title", "location", "rootCause", "impact", "invariant", "reproduction"];
  const allowed = new Set([...required, "tools"]);
  const keys = Object.keys(report);
  if (keys.some(key => !allowed.has(key))) return false;
  for (const key of required) {
    if (typeof report[key] !== "string" || !report[key].trim() || report[key].trim().length > 600) return false;
  }
  if (report.tools !== undefined && (typeof report.tools !== "string" || report.tools.trim().length > 200)) return false;
  return true;
}
function validSubmissionBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort().join();
  if (keys !== "claim,targetSha256" && keys !== "claim,report,targetSha256") return false;
  if (body.claim !== "donation-share-inflation" || body.targetSha256 !== DEMO_PROGRAM.targetSha256) return false;
  return body.report === undefined || validStructuredReport(body.report);
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
  invitedAgentBadges = [], agentDomain, lookupAgent = lookupConcordiumAgent,
  allowedOrigins = [], teamAccounts = [], invitedResearcherAccounts = [], lookupAccountInfo,
  secureCookies = process.env.NODE_ENV === "production",
  execute = executeJob, now = Date.now, maxJobs = 16, programStorePath = null,
  generateSetup = generateAgentSetup, anchorService = createConcordiumAnchorService(),
  x402Cap = Number(process.env.VERIPOC_X402_CAP ?? DEFAULT_X402_CAP),
  verifyPaymentOnChain = verifyConcordiumTestnetTx } = {}) {
  if (typeof token !== "string" || token.length < 32) throw new Error("AUDITOR_API_TOKEN must be at least 32 characters");
  const configured = [teamToken, researcherToken].filter(value => value !== undefined);
  if (configured.some(value => typeof value !== "string" || value.length < 32)
    || (configured.length && (configured.length !== 2 || new Set([token, teamToken, researcherToken]).size !== 3)))
    throw new Error("distinct AUDITOR_TEAM_TOKEN and AUDITOR_RESEARCHER_TOKEN of at least 32 characters are required together");
  if (!Array.isArray(invitedAgentBadges) || invitedAgentBadges.some(badge => typeof badge !== "string")
    || (invitedAgentBadges.length && (!agentDomain || !teamToken || !researcherToken)))
    throw new Error("signed agent access requires an explicit domain, invitation, and both program tokens");
  const walletAuth = createWalletAuthStore({ allowedOrigins, teamAccounts, invitedResearcherAccounts, lookupAccountInfo, now });
  const programStore = createProgramStore({ filePath: programStorePath, now });
  const jobs = new Map();
  const idempotency = new Map();
  const submissions = new Map();
  let programRuns = 0;
  const buckets = new Map();
  const usedAgentNonces = new Map();
  const usedTxHashes = new Set();
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
    const isAuth = path.startsWith("/v1/auth/");
    if (isAuth) {
      const authKey = `${req.socket.remoteAddress}:auth:${req.method === "POST" ? "write" : "read"}`;
      const authLimit = req.method === "POST" ? 30 : 120;
      const authBucket = buckets.get(authKey);
      const authNow = now();
      const nextAuth = !authBucket || authNow - authBucket.start >= 60_000 ? { start: authNow, count: 0 } : authBucket;
      nextAuth.count++;
      buckets.set(authKey, nextAuth);
      if (nextAuth.count > authLimit) return json(res, 429, { error: "rate limit exceeded" });
      const secure = Boolean(secureCookies || req.headers["x-forwarded-proto"] === "https");
      try {
        if (req.method === "GET" && path === "/v1/auth/me") {
          return json(res, 200, walletAuth.getMe(req.headers.cookie));
        }
        if (req.method === "POST" && path === "/v1/auth/concordium/challenge") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "account")
            throw fail(400, "only account is accepted");
          return json(res, 200, walletAuth.issueChallenge({ account: body.account, origin: req.headers.origin }));
        }
        if (req.method === "POST" && path === "/v1/auth/concordium/verify") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body)
            || Object.keys(body).sort().join() !== "account,challengeId,signature")
            throw fail(400, "challengeId, account and signature are required");
          const { sessionId, session } = await walletAuth.verifyLogin({
            challengeId: body.challengeId, account: body.account, origin: req.headers.origin, signature: body.signature,
          });
          return json(res, 200, session, { "set-cookie": formatSessionCookie(sessionId, { secure }) });
        }
        if (req.method === "POST" && path === "/v1/auth/role") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).join() !== "requestedRole")
            throw fail(400, "requestedRole is required");
          const session = walletAuth.setOnboardingRole({
            cookieHeader: req.headers.cookie, origin: req.headers.origin,
            csrfHeader: req.headers["x-auditor-csrf"], requestedRole: body.requestedRole,
          });
          return json(res, 200, session);
        }
        if (req.method === "POST" && path === "/v1/auth/logout") {
          const result = walletAuth.logout({
            cookieHeader: req.headers.cookie, origin: req.headers.origin, csrfHeader: req.headers["x-auditor-csrf"],
          });
          return json(res, 200, result, { "set-cookie": formatClearSessionCookie({ secure }) });
        }
        return json(res, 404, { error: "not found" });
      } catch (error) {
        return json(res, error.status ?? 500, { error: error.status ? error.message : "internal error" });
      }
    }
    const programParts = path.split("/").slice(3);
    const dynamicId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
    const isDynamicProgram = path === "/v1/programs" || path === "/v1/programs/mine"
      || path === "/v1/programs/public"
      || path === "/v1/programs/agent-setup"
      || path === "/v1/programs/invited" || (path.startsWith("/v1/programs/") && dynamicId.test(programParts[0] ?? ""));
    if (isDynamicProgram) {
      const programRateKey = `${req.socket.remoteAddress}:program:${req.method === "POST" ? "write" : "read"}`;
      const programNow = now();
      const previous = buckets.get(programRateKey);
      const bucket = !previous || programNow - previous.start >= 60_000 ? { start: programNow, count: 0 } : previous;
      bucket.count++;
      buckets.set(programRateKey, bucket);
      if (bucket.count > (req.method === "POST" ? 30 : 120)) return json(res, 429, { error: "rate limit exceeded" });
      if (req.headers.authorization) return json(res, 401, { error: "wallet session required" });
      try {
        if (path === "/v1/programs/agent-setup" && req.method === "POST") {
          if (!walletAuth.isOriginAllowed(req.headers.origin)) throw fail(403, "request origin is not allowed");
          const input = validateAgentSetupInput(await readBody(req, 12_000));
          const aiKey = `${req.socket.remoteAddress}:agent-setup`;
          const previousAi = buckets.get(aiKey);
          const aiNow = now();
          const aiBucket = !previousAi || aiNow - previousAi.start >= 60_000
            ? { start: aiNow, count: 0 } : previousAi;
          aiBucket.count++;
          buckets.set(aiKey, aiBucket);
          if (aiBucket.count > 5) return json(res, 429, { error: "AI draft limit exceeded" });
          return json(res, 200, await generateSetup(input));
        }
        const account = walletAuth.accountFromCookie({ cookieHeader: req.headers.cookie, method: req.method,
          origin: req.headers.origin, csrfHeader: req.headers["x-auditor-csrf"] });
        if (path === "/v1/programs/mine" && req.method === "GET") {
          if (!account || !teamAccounts.includes(account)) throw fail(403, "team account required");
          return json(res, 200, { programs: programStore.list().filter(item => item.ownerAccount === account) });
        }
        if (path === "/v1/programs/invited" && req.method === "GET") {
          if (!account) throw fail(401, "wallet session required");
          return json(res, 200, { programs: programStore.list().filter(item => item.status === "active"
            && item.invitedResearcherAccounts.includes(account)).map(item => programForMember(item, account)) });
        }
        if (path === "/v1/programs/public" && req.method === "GET") {
          return json(res, 200, { programs: programStore.list().filter(item => item.visibility === "public"
            && item.status === "active").map(publicProgramView) });
        }
        if (path === "/v1/programs" && req.method === "POST") {
          if (!account || !teamAccounts.includes(account)) throw fail(403, "team account required");
          const item = programStore.create(account, await readBody(req, 16_384));
          return json(res, 201, { program: item });
        }
        if (!dynamicId.test(programParts[0] ?? "")) return json(res, 404, { error: "not found" });
        const item = programStore.get(programParts[0]);
        if (!item) return json(res, 404, { error: "program not found" });
        const isOwner = account === item.ownerAccount;
        const isInvited = item.status === "active" && account && item.invitedResearcherAccounts.includes(account);
        let isInvitedAgent = false;
        if (item.status === "active" && !account && req.method === "GET" && agentDomain
          && item.invitedAgentBadges.includes(req.headers["x-auditor-agent-badge"])) {
          pruneExpiredNonces(usedAgentNonces, now());
          const actor = await authorizeAgentRequest({ headers: req.headers, method: req.method, path,
            body: Buffer.alloc(0), domain: agentDomain, invitedBadges: item.invitedAgentBadges,
            lookup: lookupAgent, now, usedNonces: usedAgentNonces });
          isInvitedAgent = Boolean(actor);
        }
        if (req.method === "GET" && programParts.length === 1 && item.visibility === "public"
          && item.status === "active" && !isOwner && !isInvited && !isInvitedAgent) {
          return json(res, 200, { program: publicProgramView(item), actor: { role: "visitor" } });
        }
        if (!isOwner && !isInvited && !isInvitedAgent) return json(res, 404, { error: "program not found" });
        if (req.method === "GET" && programParts.length === 1)
          return json(res, 200, { program: isOwner ? item : programForMember(item, account,
            isInvitedAgent ? req.headers["x-auditor-agent-badge"] : null),
          actor: { role: isOwner ? "team" : "researcher" } });
        if (req.method === "GET" && programParts.length === 2 && programParts[1] === "submissions")
          return json(res, 200, { submissions: [] });
        if (req.method === "GET" && programParts.length === 2 && programParts[1] === "jobs")
          return json(res, 200, { jobs: [] });
        if (!isOwner || !account) return json(res, 403, { error: "owner account required" });
        if (req.method === "POST" && programParts.length === 2 && programParts[1] === "invitations") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body)
            || Object.keys(body).sort().join() !== "action,kind,value") throw fail(400, "invalid invitation fields");
          return json(res, 200, { program: programStore.changeInvitation(item.id, body.kind, body.value, body.action) });
        }
        if (req.method === "POST" && programParts.length === 2 && programParts[1] === "status") {
          const body = await readBody(req);
          if (!body || typeof body !== "object" || Array.isArray(body)
            || Object.keys(body).join() !== "status") throw fail(400, "invalid status fields");
          return json(res, 200, { program: programStore.changeStatus(item.id, body.status) });
        }
        return json(res, 404, { error: "not found" });
      } catch (error) { return json(res, error.status ?? 500, { error: error.status ? error.message : "internal error" }); }
    }
    const isProgram = path.startsWith("/v1/programs/") || path === "/v1/inbox";
    let actor = equalToken(req.headers.authorization, teamToken) && teamToken ? { id: DEMO_PROGRAM.ownerId, role: "team" }
      : equalToken(req.headers.authorization, researcherToken) && researcherToken ? { id: DEMO_PROGRAM.invitedResearcherIds[0], role: "researcher" } : null;
    if (isProgram && !req.headers.authorization && invitedAgentBadges.length && req.headers["x-auditor-agent-badge"]) {
      let signedBody;
      try { signedBody = req.method === "POST" ? await readRawBody(req) : Buffer.alloc(0); }
      catch (error) { return json(res, error.status ?? 400, { error: error.message }); }
      try {
        pruneExpiredNonces(usedAgentNonces, now());
        actor = await authorizeAgentRequest({ headers: req.headers, method: req.method, path,
          body: signedBody,
          domain: agentDomain, invitedBadges: invitedAgentBadges, lookup: lookupAgent,
          now, usedNonces: usedAgentNonces });
      } catch { actor = null; }
    }
    if (isProgram && !actor && !req.headers.authorization && !req.headers["x-auditor-agent-badge"] && req.headers.cookie) {
      const requestedProgramId = path === "/v1/inbox" ? DEMO_PROGRAM.id : (path.split("/")[3] ?? "");
      try {
        actor = walletAuth.programActorFromCookie({
          cookieHeader: req.headers.cookie, method: req.method, origin: req.headers.origin,
          csrfHeader: req.headers["x-auditor-csrf"], programId: requestedProgramId,
        });
      } catch (error) {
        return json(res, error.status ?? 403, { error: error.message });
      }
      if (!actor && walletAuth.readSessionFromCookie(req.headers.cookie)) {
        return json(res, 403, { error: "account is not authorized for this program" });
      }
    }
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
      if (path === "/v1/inbox") {
        if (req.method !== "GET") return json(res, 404, { error: "not found" });
        return json(res, 200, buildInboxPayload({ submissions, jobs, actor }));
      }
      if (isProgram) {
        const segments = path.split("/").slice(3);
        if (segments[0] !== DEMO_PROGRAM.id) return json(res, 404, { error: "program not found" });
        if (actor.role === "researcher" && !invitedResearcherIds.includes(actor.id)
          && !(actor.badge && invitedAgentBadges.includes(actor.badge))
          && actor.authMethod !== "concordium-wallet")
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
            actorId: job.authorId, kind: job.kind, state: job.state, fixture: job.body.fixture,
            result: job.result, anchor: job.anchor ?? null });
        }
        if (req.method === "GET" && segments.length === 4 && segments[1] === "jobs" && segments[3] === "anchor") {
          const job = jobs.get(segments[2]);
          if (!job || job.programId !== DEMO_PROGRAM.id || (actor.role !== "team" && job.authorId !== actor.id))
            return json(res, 404, { error: "job not found" });
          return json(res, 200, job.anchor ?? { anchored: false, jobId: job.id });
        }
        if (req.method === "GET" && segments.length === 4 && segments[1] === "jobs" && segments[3] === "evidence") {
          const job = jobs.get(segments[2]);
          if (!job || job.programId !== DEMO_PROGRAM.id || (actor.role !== "team" && job.authorId !== actor.id))
            return json(res, 404, { error: "job not found" });
          if (job.state !== "finished" || !job.result)
            return json(res, 409, { error: "verification job has not finished yet", state: job.state });
          const submission = submissions.get(job.submissionId);
          return json(res, 200, {
            jobId: job.id,
            programId: job.programId,
            submissionId: job.submissionId,
            actorId: job.authorId,
            fixture: job.body.fixture,
            claim: submission?.claim ?? null,
            targetSha256: submission?.targetSha256 ?? DEMO_PROGRAM.targetSha256,
            verdict: job.result.status,
            evidence: job.result,
          });
        }
        if (req.method !== "POST") return json(res, 404, { error: "not found" });
        const isJobAnchor = segments.length === 4 && segments[1] === "jobs" && segments[3] === "anchor";
        if (isJobAnchor) {
          if (actor.role !== "team" || actor.badge) return json(res, 403, { error: "human team role required" });
          const job = jobs.get(segments[2]);
          if (!job || job.programId !== DEMO_PROGRAM.id) return json(res, 404, { error: "job not found" });
          if (job.state !== "finished" || !job.result?.receipt) return json(res, 409, { error: "finished verification receipt required before anchoring" });
          if (job.anchor?.anchored) return json(res, 409, { error: "job receipt already anchored" });
          const reqKey = req.headers["idempotency-key"];
          if (typeof reqKey !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(reqKey)) throw fail(400, "valid Idempotency-Key required");
          const digest = job.result.receipt.receiptHash ?? receiptHash(job.result.receipt);
          const anchorRes = await anchorService.anchorReceipt({
            programId: DEMO_PROGRAM.id,
            sessionId: `job-${job.id}`,
            receiptSha256: digest,
            agentBadge: job.authorId?.startsWith("agent:") ? job.authorId.slice(6) : undefined,
          });
          if (!anchorRes.anchored) return json(res, 503, anchorRes);
          job.anchor = anchorRes;
          return json(res, 201, { anchor: anchorRes, jobId: job.id });
        }
        const isAdvisoryNote = segments.length === 4 && segments[1] === "submissions" && segments[3] === "agent-note";
        const isTriage = segments.length === 4 && segments[1] === "submissions" && segments[3] === "triage";
        const isPatchRetest = segments.length === 4 && segments[1] === "submissions" && segments[3] === "patch-retest";
        const isSettle = segments.length === 4 && segments[1] === "submissions" && segments[3] === "settle";
        if (isAdvisoryNote || isTriage || isPatchRetest || isSettle) {
          if (actor.role !== "team") return json(res, 403, { error: "team role required" });
          const targetSub = submissions.get(segments[2]);
          if (!targetSub || targetSub.programId !== DEMO_PROGRAM.id) return json(res, 404, { error: "submission not found" });
          if (isAdvisoryNote) {
            const note = {
              id: randomUUID(),
              authorId: actor.id,
              createdAt: new Date(now()).toISOString(),
              ...validateAdvisoryNote(await readBody(req)),
            };
            targetSub.advisoryNotes.push(note);
            return json(res, 201, { note, submission: targetSub });
          }
          if (isTriage) {
            if (actor.badge) return json(res, 403, { error: "human team approval required; agents cannot finalize triage" });
            const decision = validateTriageDecision(await readBody(req));
            targetSub.triage = { ...decision, decidedBy: actor.id, decidedAt: new Date(now()).toISOString() };
            return json(res, 200, { triage: targetSub.triage, submission: targetSub });
          }
          if (isSettle) {
            if (actor.badge) return json(res, 403, { error: "human team approval required for settlement" });
            const settleKey = req.headers["idempotency-key"];
            if (typeof settleKey !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(settleKey)) throw fail(400, "valid Idempotency-Key required");
            const settleBody = await readBody(req);
            if (!settleBody || typeof settleBody !== "object" || Array.isArray(settleBody)) throw fail(400, "settlement payload required");
            const settleScopeKey = `${DEMO_PROGRAM.id}:settle:${targetSub.id}:${settleKey}`;
            const settleFingerprint = sha(JSON.stringify([DEMO_PROGRAM.id, targetSub.id, settleBody]));
            const priorSettle = idempotency.get(settleScopeKey);
            if (priorSettle) {
              return priorSettle.fingerprint === settleFingerprint
                ? json(res, 200, { settlement: targetSub.settlement, submission: targetSub })
                : json(res, 409, { error: "idempotency key reused for a different settlement" });
            }
            if (targetSub.settlement?.settled) throw fail(409, "submission already settled");
            const vulnJob = (targetSub.jobIds ?? []).map(id => jobs.get(id)).find(
              j => j?.state === "finished" && j.result?.status === "reproduced" && j.result?.receipt,
            );
            const patchJob = (targetSub.patchRetestJobIds ?? []).map(id => jobs.get(id)).find(
              j => j?.state === "finished" && j.result?.status === "not_reproduced" && j.result?.receipt,
            );
            if (!vulnJob || !patchJob) {
              return json(res, 409, { error: "both finished reproduced exploit receipt and not_reproduced patch retest receipt are required before settlement" });
            }
            const receiptSha256 = vulnJob.result.receipt.receiptHash ?? receiptHash(vulnJob.result.receipt);
            const patchReceiptSha256 = patchJob.result.receipt.receiptHash ?? receiptHash(patchJob.result.receipt);
            const terms = buildPaymentTerms({
              programId: DEMO_PROGRAM.id,
              submissionId: targetSub.id,
              amount: settleBody.amount,
              recipient: settleBody.recipient,
              receiptSha256,
              patchReceiptSha256,
              spendingCap: x402Cap,
            });
            const paymentHeader = req.headers["x-payment"];
            if (!paymentHeader) {
              return json(
                res,
                402,
                { error: "payment required", x402: terms },
                { "x-payment-required": Buffer.from(JSON.stringify(terms)).toString("base64") },
              );
            }
            const settlement = await verifyX402Payment({
              headerValue: paymentHeader,
              terms,
              usedTxHashes,
              verifyOnChain: verifyPaymentOnChain,
              now,
            });
            targetSub.settlement = settlement;
            idempotency.set(settleScopeKey, { fingerprint: settleFingerprint, id: settlement.txHash });
            return json(res, 200, { settlement, submission: targetSub });
          }
          if (!fixtureRevisionMatches()) return json(res, 409, { error: "reviewed fixture revision changed" });
          const retestKey = req.headers["idempotency-key"];
          if (typeof retestKey !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(retestKey)) throw fail(400, "valid Idempotency-Key required");
          const retestBody = { artifactFormat: "repo-fixture-v1", fixture: "patched" };
          const scopedRetestKey = `${DEMO_PROGRAM.id}:${actor.id}:patch-retest:${targetSub.id}:${retestKey}`;
          const retestFingerprint = sha(JSON.stringify([DEMO_PROGRAM.id, actor.id, "patch-retest", targetSub.id, retestBody]));
          const priorRetest = idempotency.get(scopedRetestKey);
          if (priorRetest) return priorRetest.fingerprint === retestFingerprint
            ? json(res, 202, { id: priorRetest.id, state: jobs.get(priorRetest.id).state, fixture: "patched", isPatchRetest: true })
            : json(res, 409, { error: "idempotency key reused for a different request" });
          if (programRuns >= DEMO_PROGRAM.runLimit) throw fail(429, "program run limit reached");
          if (jobs.size >= maxJobs) throw fail(503, "job capacity reached; restart local server after reviewing results");
          const retestJob = {
            id: randomUUID(), programId: DEMO_PROGRAM.id, authorId: actor.id, submissionId: targetSub.id,
            kind: "verify", body: retestBody, state: "queued", result: null, isPatchRetest: true,
            createdAt: new Date(now()).toISOString(),
          };
          jobs.set(retestJob.id, retestJob);
          targetSub.patchRetestJobIds.push(retestJob.id);
          programRuns++;
          idempotency.set(scopedRetestKey, { fingerprint: retestFingerprint, id: retestJob.id });
          queue.push(retestJob);
          pump();
          return json(res, 202, { id: retestJob.id, state: retestJob.state, fixture: "patched", isPatchRetest: true });
        }
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
        if (isSubmission && !validSubmissionBody(body))
          throw fail(400, "only the reviewed vault claim, target revision, and valid structured report are accepted");
        if (isRun && !validBody("verify", body)) throw fail(400, "only reviewed repository fixtures are accepted");
        if (isSubmission) {
          const report = body.report ? {
            title: body.report.title.trim(),
            location: body.report.location.trim(),
            rootCause: body.report.rootCause.trim(),
            impact: body.report.impact.trim(),
            invariant: body.report.invariant.trim(),
            reproduction: body.report.reproduction.trim(),
            ...(body.report.tools?.trim() ? { tools: body.report.tools.trim() } : {}),
          } : undefined;
          const item = { id: randomUUID(), programId: DEMO_PROGRAM.id, authorId: actor.id,
            claim: body.claim, targetSha256: body.targetSha256, ...(report ? { report } : {}),
            createdAt: new Date(now()).toISOString(), advisoryNotes: [], triage: null, jobIds: [], patchRetestJobIds: [] };
          submissions.set(item.id, item);
          idempotency.set(scopedKey, { fingerprint, id: item.id });
          return json(res, 201, item);
        }
        if (programRuns >= DEMO_PROGRAM.runLimit) throw fail(429, "program run limit reached");
        if (jobs.size >= maxJobs) throw fail(503, "job capacity reached; restart local server after reviewing results");
        const job = { id: randomUUID(), programId: DEMO_PROGRAM.id, authorId: actor.id,
          submissionId: submission.id, kind: "verify", body, state: "queued", result: null,
          isPatchRetest: false, createdAt: new Date(now()).toISOString() };
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
