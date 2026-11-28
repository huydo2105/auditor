import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { AccountAddress } from "@concordium/web-sdk";
import {
  buildAnchorPayload,
  CONCORDIUM_TESTNET_CHAIN,
  createConcordiumAnchorService,
} from "./concordium-anchor.mjs";

const { privateKey } = generateKeyPairSync("ed25519");
const privDer = privateKey.export({ format: "der", type: "pkcs8" });
const privateKeyHex = privDer.subarray(privDer.length - 32).toString("hex");
const senderAccount = AccountAddress.fromBuffer(new Uint8Array(32).fill(0x77)).address;

test("anchor payload commits only bounded metadata and excludes exploit details", () => {
  const receiptSha256 = "a".repeat(64);
  const { payload, encoded, payloadSha256 } = buildAnchorPayload({
    programId: "demo-vault",
    sessionId: "job-11111111-1111-4111-8111-111111111111",
    receiptSha256,
    agentBadge: "JyP9UhUtd9AeJywDRsg5q",
  });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.kind, "veripoc-receipt-anchor");
  assert.equal(payload.receiptSha256, receiptSha256);
  assert.doesNotMatch(encoded, /vulnerable|patched|reproduced|FixtureVault|exploit|secret/i);
  assert.match(payloadSha256, /^[a-f0-9]{64}$/);

  assert.throws(() => buildAnchorPayload({ programId: "../bad", sessionId: "ok-1", receiptSha256 }), /programId/);
  assert.throws(() => buildAnchorPayload({ programId: "demo-vault", sessionId: "ok-1", receiptSha256: "short" }), /receiptSha256/);
});

test("unconfigured Concordium anchor service fails honestly without fabricating a txHash", async () => {
  const service = createConcordiumAnchorService({ account: "", privateKey: "" });
  assert.equal(service.isConfigured(), false);
  const res = await service.anchorReceipt({
    programId: "demo-vault",
    sessionId: "job-11111111-1111-4111-8111-111111111111",
    receiptSha256: "b".repeat(64),
  });
  assert.equal(res.anchored, false);
  assert.equal(res.mode, "unconfigured");
  assert.equal(res.txHash, undefined);
});

test("configured anchor signs RegisterData tx, enforces replay uniqueness, and reads back status", async () => {
  const expectedTxHash = "c".repeat(64);
  let sentTx = null;
  let sentSig = null;
  const mockClient = {
    getNextAccountNonce: async () => ({ nonce: 7n }),
    sendAccountTransaction: async (tx, sig) => {
      sentTx = tx;
      sentSig = sig;
      return expectedTxHash;
    },
    waitForTransactionFinalization: async hash => ({ hash, summary: { type: "accountTransaction" } }),
    getBlockItemStatus: async hash => ({ status: "finalized", hash }),
  };

  const service = createConcordiumAnchorService({
    account: senderAccount,
    privateKey: privateKeyHex,
    createClient: () => mockClient,
    now: () => 1_760_000_000_000,
  });
  assert.equal(service.isConfigured(), true);

  const anchored = await service.anchorReceipt({
    programId: "demo-vault",
    sessionId: "job-22222222-2222-4222-8222-222222222222",
    receiptSha256: "d".repeat(64),
  });
  assert.equal(anchored.anchored, true);
  assert.equal(anchored.mode, "concordium-testnet");
  assert.equal(anchored.network, CONCORDIUM_TESTNET_CHAIN);
  assert.equal(anchored.txHash, expectedTxHash);
  assert.ok(sentTx && sentSig);

  // Replay with same session or same digest rejects with 409.
  await assert.rejects(
    () => service.anchorReceipt({
      programId: "demo-vault",
      sessionId: "job-22222222-2222-4222-8222-222222222222",
      receiptSha256: "e".repeat(64),
    }),
    err => err.status === 409,
  );
  await assert.rejects(
    () => service.anchorReceipt({
      programId: "demo-vault",
      sessionId: "job-33333333-3333-4333-8333-333333333333",
      receiptSha256: "d".repeat(64),
    }),
    err => err.status === 409,
  );

  const verified = await service.verifyAnchor(expectedTxHash);
  assert.equal(verified.status.status, "finalized");
});
