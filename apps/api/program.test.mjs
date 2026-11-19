import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApiServer } from "./server.mjs";
import { DEMO_PROGRAM, fixtureRevisionMatches } from "./program.mjs";

const token = "operator-token-with-at-least-thirty-two-characters";
const teamToken = "team-token-with-at-least-thirty-two-characters";
const researcherToken = "researcher-token-with-at-least-thirty-two-characters";
const root = "/v1/programs/demo-vault";
const runBody = fixture => ({ artifactFormat: "repo-fixture-v1", fixture });
const claimBody = { claim: "donation-share-inflation", targetSha256: DEMO_PROGRAM.targetSha256 };

async function withServer(fn, options = {}) {
  const server = createApiServer({ token, teamToken, researcherToken,
    execute: async (_kind, body) => ({ status: body.fixture === "vulnerable" ? "reproduced" : "not_reproduced",
      receipt: { private: true, input: { sourceSha256: DEMO_PROGRAM.workerInputSha256 } },
      anchor: { receiptSha256: "a".repeat(64) } }), ...options });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
async function api(base, path, auth, body, key = randomUUID()) {
  const response = await fetch(base + path, { method: body ? "POST" : "GET", headers: {
    Authorization: `Bearer ${auth}`, ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}

test("reviewed fixture revision is pinned", () => assert.equal(fixtureRevisionMatches(), true));
test("separate role tokens and invitation guard the same program", async () => {
  await withServer(async base => {
    assert.equal((await api(base, root, token)).status, 401);
    assert.equal((await api(base, root, "unknown-token-with-at-least-thirty-two-chars")).status, 401);
    assert.equal((await api(base, "/v1/programs/other", researcherToken)).status, 404);
    assert.equal((await api(base, root, teamToken)).data.actor.role, "team");
    assert.equal((await api(base, root, researcherToken)).data.actor.role, "researcher");
    assert.equal((await api(base, `${root}/submissions`, teamToken, claimBody)).status, 403);
    assert.equal((await api(base, "/v1/verify-poc", researcherToken, runBody("vulnerable"))).status, 401);
  });
  await withServer(async base => {
    assert.equal((await api(base, root, researcherToken)).status, 403);
  }, { invitedResearcherIds: [] });
});

test("claim, jobs, replay, quota and private evidence remain program scoped", async () => {
  await withServer(async base => {
    assert.equal((await api(base, `${root}/submissions`, researcherToken, { ...claimBody, targetSha256: "0".repeat(64) })).status, 400);
    const claimKey = "reviewed-claim-key";
    const first = await api(base, `${root}/submissions`, researcherToken, claimBody, claimKey);
    assert.equal(first.status, 201);
    assert.equal((await api(base, `${root}/submissions`, researcherToken, claimBody, claimKey)).data.id, first.data.id);
    assert.equal((await api(base, `${root}/submissions`, researcherToken, { ...claimBody, claim: "other" }, claimKey)).status, 409);
    const path = `${root}/submissions/${first.data.id}/jobs`;
    assert.equal((await api(base, path, teamToken, runBody("vulnerable"))).status, 403);
    assert.equal((await api(base, path, researcherToken, runBody("external"))).status, 400);
    assert.equal((await api(base, `${root}/submissions/${randomUUID()}/jobs`, researcherToken, runBody("vulnerable"))).status, 404);
    const runKey = "reviewed-run-key";
    const accepted = await api(base, path, researcherToken, runBody("vulnerable"), runKey);
    assert.equal(accepted.status, 202);
    assert.equal((await api(base, path, researcherToken, runBody("vulnerable"), runKey)).data.id, accepted.data.id);
    assert.equal((await api(base, path, researcherToken, runBody("patched"), runKey)).status, 409);
    assert.equal((await api(base, `/v1/jobs/${accepted.data.id}`, researcherToken)).status, 401);
    assert.equal((await api(base, `/v1/jobs/${accepted.data.id}`, token)).status, 404);
    assert.equal((await api(base, `/v1/programs/other/jobs/${accepted.data.id}`, teamToken)).status, 404);
    let job;
    for (let i = 0; i < 20; i++) {
      job = await api(base, `${root}/jobs/${accepted.data.id}`, teamToken);
      if (job.data.state === "finished") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.data.result.receipt.private, true);
    assert.equal((await api(base, `${root}/jobs/${accepted.data.id}`, token)).status, 401);
    assert.equal((await api(base, `${root}/submissions`, teamToken)).data.submissions[0].jobIds[0], accepted.data.id);
  });
  await withServer(async base => {
    const claim = await api(base, `${root}/submissions`, researcherToken, claimBody);
    const path = `${root}/submissions/${claim.data.id}/jobs`;
    for (let i = 0; i < DEMO_PROGRAM.runLimit; i++) assert.equal((await api(base, path, researcherToken, runBody("patched"))).status, 202);
    assert.equal((await api(base, path, researcherToken, runBody("patched"))).status, 429);
  }, { now: () => 0 });
});

test("program tokens are distinct and must be configured together", () => {
  assert.throws(() => createApiServer({ token, teamToken }), /required together/);
  assert.throws(() => createApiServer({ token, teamToken: token, researcherToken }), /distinct/);
});

test("a successful worker verdict with a different image input hash is rejected", async () => {
  await withServer(async base => {
    const claim = await api(base, `${root}/submissions`, researcherToken, claimBody);
    const accepted = await api(base, `${root}/submissions/${claim.data.id}/jobs`, researcherToken, runBody("vulnerable"));
    let job;
    for (let i = 0; i < 20; i++) {
      job = await api(base, `${root}/jobs/${accepted.data.id}`, teamToken);
      if (job.data.state === "finished") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(job.data.result.status, "tool_error");
    assert.equal(job.data.result.receipt, undefined);
  }, { execute: async () => ({ status: "reproduced", receipt: { input: { sourceSha256: "0".repeat(64) } } }) });
});

test("external bounty scopes, arbitrary PoCs, and cross-scope job reads fail closed", async () => {
  await withServer(async base => {
    const legacy = await api(base, "/v1/verify-poc", token, runBody("vulnerable"));
    assert.equal(legacy.status, 202);
    assert.equal((await api(base, `${root}/jobs/${legacy.data.id}`, teamToken)).status, 404);
    assert.equal((await api(base, `${root}/jobs/${legacy.data.id}`, researcherToken)).status, 404);

    for (const slug of ["aave", "orca", "raydium"]) {
      assert.equal((await api(base, `/v1/programs/${slug}`, researcherToken)).status, 404);
      assert.equal((await api(base, `/v1/programs/${slug}/submissions`, researcherToken, claimBody)).status, 404);
    }
    assert.equal((await api(base, `${root}/submissions`, researcherToken, { claim: "aave", targetSha256: DEMO_PROGRAM.targetSha256 })).status, 400);
    assert.equal((await api(base, `${root}/submissions`, researcherToken, { ...claimBody, poc: "contract Exploit {}" })).status, 400);

    const claim = await api(base, `${root}/submissions`, researcherToken, claimBody);
    const programJob = await api(base, `${root}/submissions/${claim.data.id}/jobs`, researcherToken, runBody("vulnerable"));
    assert.equal(programJob.status, 202);
    assert.equal((await api(base, `/v1/jobs/${programJob.data.id}`, token)).status, 404);
    assert.equal((await api(base, `${root}/jobs/${programJob.data.id}`, token)).status, 401);
    assert.equal((await api(base, `${root}/jobs/${programJob.data.id}`, teamToken)).status, 200);
    assert.equal((await api(base, `${root}/jobs/${programJob.data.id}`, researcherToken)).status, 200);
  });

  await withServer(async base => {
    assert.equal((await api(base, `${root}/submissions`, researcherToken)).status, 403);
    assert.equal((await api(base, `${root}/jobs/${randomUUID()}`, researcherToken)).status, 403);
    assert.equal((await api(base, `${root}/submissions`, researcherToken, claimBody)).status, 403);
  }, { invitedResearcherIds: [] });
});
