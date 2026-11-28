import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "./server.mjs";
import { DEMO_PROGRAM } from "./program.mjs";

const operatorToken = "triage-operator-token-with-at-least-thirty-two-chars-1";
const teamToken = "triage-team-token-with-at-least-thirty-two-chars-00002";
const researcherToken = "triage-researcher-token-with-thirty-two-chars-0000003";

async function startServer() {
  const server = createApiServer({
    token: operatorToken,
    teamToken,
    researcherToken,
    execute: async (_kind, body) => ({
      status: body.fixture === "vulnerable" ? "reproduced" : "not_reproduced",
      receipt: {
        receiptHash: body.fixture === "vulnerable" ? "a".repeat(64) : "b".repeat(64),
        input: { sourceSha256: DEMO_PROGRAM.workerInputSha256 },
      },
    }),
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

test("team inbox scopes private submissions, supports advisory notes, human triage, and patch retest", async () => {
  const { base, close } = await startServer();
  try {
    // 1. Unauthenticated /v1/inbox and wrong token fail closed.
    assert.equal((await fetch(`${base}/v1/inbox`)).status, 401);
    assert.equal((await fetch(`${base}/v1/inbox`, { headers: { authorization: `Bearer ${operatorToken}` } })).status, 401);

    // 2. Invited researcher submits finding and runs vulnerable fixture.
    const subRes = await fetch(`${base}/v1/programs/demo-vault/submissions`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "triage-sub-001" },
      body: JSON.stringify({
        claim: "donation-share-inflation",
        targetSha256: DEMO_PROGRAM.targetSha256,
        report: {
          title: "Donation share inflation",
          location: "contracts/evm/FixtureVault.sol#previewDeposit",
          rootCause: "No virtual shares",
          impact: "Victim receives 0 shares",
          invariant: "Non-zero deposit mints non-zero shares",
          reproduction: "Run VulnerableVault fixture",
        },
      }),
    });
    assert.equal(subRes.status, 201);
    const sub = await subRes.json();

    const vulnJobRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "triage-vuln-001" },
      body: JSON.stringify({ artifactFormat: "repo-fixture-v1", fixture: "vulnerable" }),
    });
    assert.equal(vulnJobRes.status, 202);
    await new Promise(resolve => setTimeout(resolve, 40));

    // 3. Researcher cannot post team advisory notes, finalize triage, or launch team patch retest.
    const forbiddenNote = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/agent-note`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json" },
      body: JSON.stringify({ summary: "Should fail", suggestedDecision: "accept" }),
    });
    assert.equal(forbiddenNote.status, 403);

    const forbiddenTriage = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/triage`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept", rationale: "Self-approving" }),
    });
    assert.equal(forbiddenTriage.status, 403);

    const forbiddenRetest = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/patch-retest`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "triage-res-retest" },
      body: JSON.stringify({}),
    });
    assert.equal(forbiddenRetest.status, 403);

    // 4. Team posts advisory note (advisory=true, canFinalize=false; submission stays un-triaged).
    const noteRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/agent-note`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: "Foundry reproduced exploit cleanly. Suggest accepting finding and adding virtual shares.",
        suggestedDecision: "accept",
        suggestedPatch: "Use totalSupply + VIRTUAL_SHARES in previewDeposit.",
        confidence: "high",
      }),
    });
    assert.equal(noteRes.status, 201);
    const noteData = await noteRes.json();
    assert.equal(noteData.note.advisory, true);
    assert.equal(noteData.note.canFinalize, false);
    assert.equal(noteData.submission.triage, null);

    // 5. Human team records final triage decision & runs patch retest against PatchedVault.
    const triageRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/triage`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json" },
      body: JSON.stringify({ decision: "accept", rationale: "Verified reproduced exploit receipt." }),
    });
    assert.equal(triageRes.status, 200);
    assert.equal((await triageRes.json()).triage.decision, "accept");

    const retestRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/patch-retest`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "triage-team-retest-1" },
      body: JSON.stringify({}),
    });
    assert.equal(retestRes.status, 202);
    const retestJob = await retestRes.json();
    assert.equal(retestJob.fixture, "patched");
    assert.equal(retestJob.isPatchRetest, true);

    // Repeating same idempotency key returns same retest job without burning quota.
    const replayRetest = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/patch-retest`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "triage-team-retest-1" },
      body: JSON.stringify({}),
    });
    assert.equal(replayRetest.status, 202);
    assert.equal((await replayRetest.json()).id, retestJob.id);

    await new Promise(resolve => setTimeout(resolve, 40));

    // 6. Team inbox includes finding, advisory note, triage status change, and patched retest receipt.
    const inboxRes = await fetch(`${base}/v1/inbox`, { headers: { authorization: `Bearer ${teamToken}` } });
    assert.equal(inboxRes.status, 200);
    const inbox = await inboxRes.json();
    assert.equal(inbox.actor.role, "team");
    assert.equal(inbox.submissions.length, 1);
    assert.equal(inbox.submissions[0].patchRetestJobs[0].verdict, "not_reproduced");
    assert.ok(inbox.counts.new_finding >= 1);
    assert.ok(inbox.counts.status_change >= 3);

    // Non-existent submission returns 404.
    const missingSub = await fetch(`${base}/v1/programs/demo-vault/submissions/00000000-0000-4000-8000-000000000000/triage`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json" },
      body: JSON.stringify({ decision: "reject", rationale: "Missing" }),
    });
    assert.equal(missingSub.status, 404);
  } finally {
    await close();
  }
});
