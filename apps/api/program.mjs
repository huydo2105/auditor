import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const hash = value => createHash("sha256").update(value).digest("hex");
const digest = path => hash(readFileSync(new URL(path, import.meta.url)));
const workerFiles = ["foundry.toml", "src/Counter.sol", "contracts/evm/MockAsset.sol",
  "contracts/evm/FixtureVault.sol", "test/Counter.t.sol", "test/VaultFixture.t.sol", "test/TrustedVaultWorker.t.sol"];

// These bytes are the reviewed local fixture at main 61c0be7. Fail closed if either changes.
export const DEMO_PROGRAM = Object.freeze({
  id: "demo-vault",
  name: "Demo Vault Audit Program",
  ownerId: "demo-team",
  invitedResearcherIds: ["demo-researcher"],
  status: "active",
  confidentiality: "members-only",
  runLimit: 4,
  target: "contracts/evm/FixtureVault.sol",
  targetSha256: "0151b8d3c7e0dfa8cb1851f4663761e06c4e676c50df31b0acd1baf4acfa1eb1",
  oracle: "test/TrustedVaultWorker.t.sol",
  oracleSha256: "38d8776b2ef0d63f1919b6e8f2ba17a57373dfbabcba6cac57ccbc799259d32d",
  // Dockerfile input.sha256: SHA-256 of its ordered sha256sum manifest.
  workerInputSha256: "568a2a49699b7949678647a8e2fb48bee9db1a95c2d6f88f7ce7202f18d62f66",
  allowedFixtures: ["vulnerable", "patched"],
  rules: ["Reviewed local EVM fixtures only", "No deployed or external targets", "No arbitrary code or PoC uploads", "Private results for program members only"],
  authorization: "VeriPoC-owned synthetic fixture; local demonstration only",
});

export function fixtureRevisionMatches() {
  try { return digest("../../contracts/evm/FixtureVault.sol") === DEMO_PROGRAM.targetSha256
    && digest("../../test/TrustedVaultWorker.t.sol") === DEMO_PROGRAM.oracleSha256
    && hash(workerFiles.map(path => `${digest(`../../${path}`)}  ${path}\n`).join("")) === DEMO_PROGRAM.workerInputSha256; }
  catch { return false; }
}

export function publicProgram(runsUsed) {
  return { ...DEMO_PROGRAM, runsUsed };
}
