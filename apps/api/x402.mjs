import { createHash } from "node:crypto";
import { ConcordiumGRPCWebClient } from "@concordium/web-sdk";
import { CCD_TESTNET_EXPLORER, CONCORDIUM_TESTNET_CHAIN } from "../../packages/core/concordium-anchor.mjs";

export const DEFAULT_X402_CAP = 100;
const DEFAULT_ASSET = "CCD";
const DEFAULT_RECIPIENT = process.env.VERIPOC_X402_RECIPIENT || "3x4mP1eResearcherTestnetRecipientAddress0000000000";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const bad = (status, message) => Object.assign(new Error(message), { status });

export function buildPaymentTerms({
  programId,
  submissionId,
  amount,
  asset = DEFAULT_ASSET,
  network = CONCORDIUM_TESTNET_CHAIN,
  recipient = DEFAULT_RECIPIENT,
  receiptSha256,
  patchReceiptSha256,
  spendingCap = DEFAULT_X402_CAP,
} = {}) {
  const numericAmount = Number(amount);
  const numericCap = Number(spendingCap);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > numericCap) {
    throw bad(400, `amount must be > 0 and <= ${numericCap} ${asset}`);
  }
  if (!/^[a-f0-9]{64}$/.test(receiptSha256 ?? "") || !/^[a-f0-9]{64}$/.test(patchReceiptSha256 ?? "")) {
    throw bad(409, "both reproduced and patched not_reproduced receipts are required");
  }
  if (typeof recipient !== "string" || recipient.trim().length < 10 || recipient.trim().length > 100) {
    throw bad(400, "valid Testnet recipient address is required");
  }
  return {
    scheme: "exact",
    network,
    asset,
    amount: String(numericAmount),
    recipient: recipient.trim(),
    spendingCap: String(numericCap),
    memo: sha256(`${programId}:${submissionId}:${receiptSha256}:${patchReceiptSha256}`),
    programId,
    submissionId,
  };
}

export async function verifyConcordiumTestnetTx(txHash, {
  grpcUrl = process.env.CONCORDIUM_GRPC_URL || "https://grpc.testnet.concordium.com",
  grpcPort = Number(process.env.CONCORDIUM_GRPC_PORT || 20000),
} = {}) {
  const client = new ConcordiumGRPCWebClient(grpcUrl, grpcPort, { timeout: 10_000 });
  const itemStatus = await client.getBlockItemStatus(txHash);
  const statusKind = itemStatus?.status;
  if (statusKind !== "finalized" && statusKind !== "committed") {
    return { verified: false, reason: `transaction status is ${String(statusKind ?? "unknown")}` };
  }
  return { verified: true, explorerUrl: `${CCD_TESTNET_EXPLORER}${txHash}` };
}

export function parsePaymentHeader(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim() || headerValue.length > 2048) {
    throw bad(402, "missing X-PAYMENT header");
  }
  let raw = headerValue.trim();
  if (!raw.startsWith("{")) {
    try {
      raw = Buffer.from(raw, "base64").toString("utf8");
    } catch {
      throw bad(400, "invalid X-PAYMENT encoding");
    }
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw bad(400, "invalid X-PAYMENT JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw bad(400, "invalid X-PAYMENT payload");
  }
  const { txHash, network, amount, recipient, payer } = parsed;
  if (typeof txHash !== "string" || !/^(?:0x)?[a-fA-F0-9]{64}$/.test(txHash)) {
    throw bad(400, "X-PAYMENT requires a valid 64-hex txHash");
  }
  return {
    txHash: txHash.toLowerCase(),
    network: typeof network === "string" ? network : "",
    amount: String(amount ?? ""),
    recipient: typeof recipient === "string" ? recipient : "",
    payer: typeof payer === "string" ? payer : "",
  };
}

export async function verifyX402Payment({
  headerValue,
  terms,
  usedTxHashes,
  verifyOnChain = verifyConcordiumTestnetTx,
  now = Date.now,
} = {}) {
  const payment = parsePaymentHeader(headerValue);
  if (payment.network !== terms.network) {
    throw bad(402, `payment network mismatch: expected ${terms.network}`);
  }
  if (payment.recipient !== terms.recipient) {
    throw bad(402, "payment recipient does not match x402 terms");
  }
  if (Number(payment.amount) < Number(terms.amount)) {
    throw bad(402, "payment amount is below required settlement amount");
  }
  if (usedTxHashes.has(payment.txHash)) {
    throw bad(409, "txHash already used for a prior settlement");
  }
  let chainResult;
  try {
    chainResult = await verifyOnChain(payment.txHash, terms, payment);
  } catch {
    throw bad(502, "Testnet payment verifier is unavailable");
  }
  if (!chainResult?.verified) {
    throw bad(402, chainResult?.reason || "on-chain Testnet payment not verified");
  }
  // No await between replay check and set insertion.
  if (usedTxHashes.has(payment.txHash)) {
    throw bad(409, "txHash already used for a prior settlement");
  }
  usedTxHashes.add(payment.txHash);

  return {
    settled: true,
    txHash: payment.txHash,
    explorerUrl: chainResult.explorerUrl || `${CCD_TESTNET_EXPLORER}${payment.txHash}`,
    amount: terms.amount,
    asset: terms.asset,
    network: terms.network,
    recipient: terms.recipient,
    payer: payment.payer || null,
    memo: terms.memo,
    settledAt: new Date(now()).toISOString(),
  };
}
