import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "./server.mjs";
import { DEMO_PROGRAM } from "./program.mjs";

const operatorToken = "x402-operator-token-with-at-least-thirty-two-chars-01";
const teamToken = "x402-team-token-with-at-least-thirty-two-chars-000002";
const researcherToken = "x402-researcher-token-with-thirty-two-chars-00000003";

async function startX402Server({ verifiedTx = "a".repeat(64), onChainOk = true } = {}) {
  const server = createApiServer({
    token: operatorToken,
    teamToken,
    researcherToken,
    x402Cap: 100,
    verifyPaymentOnChain: async txHash => (
      onChainOk && txHash === verifiedTx
        ? { verified: true, explorerUrl: `https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=${txHash}` }
        : { verified: false, reason: "transaction not finalized on Testnet" }
    ),
    execute: async (_kind, body) => ({
      status: body.fixture === "vulnerable" ? "reproduced" : "not_reproduced",
      receipt: {
        receiptHash: body.fixture === "vulnerable" ? "b".repeat(64) : "c".repeat(64),
        input: { sourceSha256: DEMO_PROGRAM.workerInputSha256 },
      },
    }),
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
}

test("x402 settlement requires both reproduced and patched receipts, enforces cap, verifies on-chain tx, and blocks replay", async () => {
  const validTx = "9".repeat(64);
  const { base, close } = await startX402Server({ verifiedTx: validTx, onChainOk: true });
  try {
    const sub = await (await fetch(`${base}/v1/programs/demo-vault/submissions`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "x402-sub-01" },
      body: JSON.stringify({ claim: "donation-share-inflation", targetSha256: DEMO_PROGRAM.targetSha256 }),
    })).json();

    // Missing exploit & patch receipts -> 409.
    const missingBoth = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "x402-settle-01" },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(missingBoth.status, 409);

    // Run exploit reproduction only -> still 409 (patch retest missing).
    await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/jobs`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "x402-vuln-01" },
      body: JSON.stringify({ artifactFormat: "repo-fixture-v1", fixture: "vulnerable" }),
    });
    await new Promise(resolve => setTimeout(resolve, 40));

    const missingPatch = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "x402-settle-02" },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(missingPatch.status, 409);

    // Run PatchedVault patch retest.
    await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/patch-retest`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "x402-patch-01" },
      body: JSON.stringify({}),
    });
    await new Promise(resolve => setTimeout(resolve, 40));

    // Researcher cannot settle (403).
    const resForbidden = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: { authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "x402-res-01" },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(resForbidden.status, 403);

    // Above Testnet cap rejected (400).
    const overCap = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "x402-cap-01" },
      body: JSON.stringify({ amount: 500 }),
    });
    assert.equal(overCap.status, 400);

    // Without X-PAYMENT -> HTTP 402 Payment Required with x402 terms & header.
    const challengeRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: { authorization: `Bearer ${teamToken}`, "content-type": "application/json", "idempotency-key": "x402-pay-01" },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(challengeRes.status, 402);
    assert.ok(challengeRes.headers.get("x-payment-required"));
    const { x402: terms } = await challengeRes.json();
    assert.equal(terms.amount, "25");
    assert.equal(terms.asset, "CCD");

    // Unverified Testnet txHash fails closed (402).
    const fakeHeader = Buffer.from(JSON.stringify({
      txHash: "0".repeat(64),
      network: terms.network,
      amount: "25",
      recipient: terms.recipient,
      payer: "demo-team",
    })).toString("base64");
    const fakeRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${teamToken}`,
        "content-type": "application/json",
        "idempotency-key": "x402-pay-fake",
        "x-payment": fakeHeader,
      },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(fakeRes.status, 402);

    // Verified Testnet txHash settles cleanly (200) & surfaces in /v1/inbox under Payments.
    const validHeader = Buffer.from(JSON.stringify({
      txHash: validTx,
      network: terms.network,
      amount: "25",
      recipient: terms.recipient,
      payer: "demo-team-wallet",
    })).toString("base64");
    const okRes = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${teamToken}`,
        "content-type": "application/json",
        "idempotency-key": "x402-pay-01",
        "x-payment": validHeader,
      },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.settlement.settled, true);
    assert.equal(okBody.settlement.txHash, validTx);

    // Attempting second settlement on same submission fails closed (409).
    const doublePay = await fetch(`${base}/v1/programs/demo-vault/submissions/${sub.id}/settle`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${teamToken}`,
        "content-type": "application/json",
        "idempotency-key": "x402-pay-02",
        "x-payment": validHeader,
      },
      body: JSON.stringify({ amount: 25 }),
    });
    assert.equal(doublePay.status, 409);

    // Inbox lists payment item with count >= 1.
    const inbox = await (await fetch(`${base}/v1/inbox`, { headers: { authorization: `Bearer ${teamToken}` } })).json();
    assert.equal(inbox.counts.payment, 1);
    assert.ok(inbox.items.some(i => i.category === "payment" && i.status === "settled"));
  } finally {
    await close();
  }
});
