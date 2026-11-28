import { createHash } from "node:crypto";
import {
  AccountAddress,
  AccountTransactionType,
  ConcordiumGRPCWebClient,
  DataBlob,
  SequenceNumber,
  TransactionExpiry,
  buildBasicAccountSigner,
  signTransaction,
} from "@concordium/web-sdk";

export const CONCORDIUM_TESTNET_CHAIN = "ccd:4221332d34e1694168c2a0c0b3fd0f27";
export const CCD_TESTNET_EXPLORER = "https://testnet.ccdscan.io/?dcount=1&dentity=transaction&dhash=";

const DEFAULT_GRPC_URL = "https://grpc.testnet.concordium.com";
const DEFAULT_GRPC_PORT = 20000;
const HEX_64_RE = /^[a-f0-9]{64}$/;
const SAFE_ID_RE = /^[a-zA-Z0-9:_-]{3,80}$/;
const FORBIDDEN_FIELDS = new Set(["fixture", "outcome", "trace", "secret", "token", "privateKey", "source", "exploit", "stdout", "stderr"]);

const sha256 = value => createHash("sha256").update(value).digest("hex");

export function buildAnchorPayload({ programId, sessionId, receiptSha256, agentBadge } = {}) {
  if (typeof programId !== "string" || !SAFE_ID_RE.test(programId)) {
    throw new Error("valid programId required for anchor");
  }
  if (typeof sessionId !== "string" || !SAFE_ID_RE.test(sessionId)) {
    throw new Error("valid sessionId required for anchor");
  }
  if (typeof receiptSha256 !== "string" || !HEX_64_RE.test(receiptSha256)) {
    throw new Error("valid 64-hex receiptSha256 required for anchor");
  }
  const payload = {
    schemaVersion: 1,
    kind: "veripoc-receipt-anchor",
    programId,
    sessionId,
    receiptSha256,
  };
  if (agentBadge !== undefined && agentBadge !== null && agentBadge !== "") {
    if (typeof agentBadge !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{15,40}$/.test(agentBadge)) {
      throw new Error("invalid Concordium agentBadge");
    }
    payload.agentBadge = agentBadge;
  }
  for (const key of Object.keys(payload)) {
    if (FORBIDDEN_FIELDS.has(key)) throw new Error("forbidden plaintext field in anchor");
  }
  const encoded = JSON.stringify(payload);
  if (Buffer.byteLength(encoded, "utf8") > 256) {
    throw new Error("anchor payload exceeds 256-byte limit");
  }
  return { payload, encoded, payloadSha256: sha256(encoded) };
}

export function createConcordiumAnchorService({
  account = process.env.CONCORDIUM_ANCHOR_ACCOUNT,
  privateKey = process.env.CONCORDIUM_ANCHOR_PRIVATE_KEY,
  grpcUrl = process.env.CONCORDIUM_GRPC_URL || DEFAULT_GRPC_URL,
  grpcPort = Number(process.env.CONCORDIUM_GRPC_PORT || DEFAULT_GRPC_PORT),
  createClient = () => new ConcordiumGRPCWebClient(grpcUrl, grpcPort, { timeout: 15_000 }),
  now = Date.now,
} = {}) {
  const anchoredSessions = new Set();
  const anchoredDigests = new Set();

  function isConfigured() {
    if (typeof account !== "string" || typeof privateKey !== "string") return false;
    if (!/^[0-9a-fA-F]{64}$/.test(privateKey.trim())) return false;
    try {
      AccountAddress.fromBase58(account.trim());
      return true;
    } catch {
      return false;
    }
  }

  async function anchorReceipt({ programId, sessionId, receiptSha256, agentBadge }) {
    const { payload, encoded, payloadSha256 } = buildAnchorPayload({ programId, sessionId, receiptSha256, agentBadge });
    if (anchoredSessions.has(sessionId)) {
      throw Object.assign(new Error("receipt session already anchored"), { status: 409 });
    }
    if (anchoredDigests.has(receiptSha256)) {
      throw Object.assign(new Error("receipt digest already anchored"), { status: 409 });
    }
    if (!isConfigured()) {
      return {
        anchored: false,
        mode: "unconfigured",
        reason: "CONCORDIUM_ANCHOR_ACCOUNT and 64-hex CONCORDIUM_ANCHOR_PRIVATE_KEY are required for Testnet anchoring",
        payload,
        payloadSha256,
      };
    }

    const sender = AccountAddress.fromBase58(account.trim());
    const signer = buildBasicAccountSigner(privateKey.trim());
    const client = createClient();
    const nextNonce = await client.getNextAccountNonce(sender);
    const seqNonce = SequenceNumber.create(
      typeof nextNonce.nonce === "object" && nextNonce.nonce !== null && "value" in nextNonce.nonce
        ? nextNonce.nonce.value
        : nextNonce.nonce,
    );
    const header = {
      sender,
      nonce: seqNonce,
      expiry: TransactionExpiry.futureMinutes(10),
    };
    const dataBlob = new DataBlob(Buffer.from(encoded, "utf8"));
    const tx = {
      type: AccountTransactionType.RegisterData,
      header,
      payload: { data: dataBlob },
    };
    const signature = await signTransaction(tx, signer);
    const txHashObj = await client.sendAccountTransaction(tx, signature);
    const txHash = typeof txHashObj === "string" ? txHashObj : txHashObj?.toString?.() ?? String(txHashObj);
    if (!/^[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error("unexpected transaction hash returned from Concordium node");
    }
    await client.waitForTransactionFinalization(txHashObj, 30_000);

    anchoredSessions.add(sessionId);
    anchoredDigests.add(receiptSha256);

    return {
      anchored: true,
      mode: "concordium-testnet",
      network: CONCORDIUM_TESTNET_CHAIN,
      txHash: txHash.toLowerCase(),
      explorerUrl: `${CCD_TESTNET_EXPLORER}${txHash.toLowerCase()}`,
      payload,
      payloadSha256,
      anchoredAt: new Date(now()).toISOString(),
    };
  }

  async function verifyAnchor(txHash) {
    if (typeof txHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(txHash)) {
      throw Object.assign(new Error("invalid 64-hex transaction hash"), { status: 400 });
    }
    const client = createClient();
    const status = await client.getBlockItemStatus(txHash);
    return { txHash: txHash.toLowerCase(), network: CONCORDIUM_TESTNET_CHAIN, status };
  }

  return { isConfigured, anchorReceipt, verifyAnchor };
}
