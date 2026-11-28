import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { AccountAddress, buildBasicAccountSigner, signMessage } from "@concordium/web-sdk";
import { privateKeyToAccount } from "viem/accounts";
import { createApiServer } from "./server.mjs";
import { createAgentGatewayClient } from "../../packages/agent-gateway/client.mjs";
import { createMcpHandler } from "../../packages/agent-gateway/mcp-server.mjs";
import { EXPLOIT_ORACLE_MARKER } from "../../workers/sandbox/arbitrary-runner.mjs";

const ORIGIN = "http://127.0.0.1:3000";
const DOMAIN = "auditor.local";
const TOKEN = "arbitrary-operator-token-thirty-two-chars-00001";
const TEAM_TOKEN = "arbitrary-team-token-at-least-thirty-two-chars-02";
const RESEARCHER_TOKEN = "arbitrary-researcher-token-thirty-two-chars-003";

const TARGET_REPO = "https://github.com/huydo2105/veripoc-vulnerable-contracts";
const TARGET_COMMIT = "361349bae6c0b77bcdd7f66c2504063bbdab40a4";

const INVITED_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";
const OTHER_KEY = "0x2222222222222222222222222222222222222222222222222222222222222222";
const UNINVITED_KEY = "0x3333333333333333333333333333333333333333333333333333333333333333";

const INVITED_BADGE = "JyP9UhUtd9AeJywDRsg5q";
const OTHER_BADGE = "KxQ8ViVue8BfKzxESth6r";
const UNINVITED_BADGE = "MzS6XkXwg6DhMbzGUvj8t";

function makeWalletIdentity(byte) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "der", type: "spki" });
  const priv = privateKey.export({ format: "der", type: "pkcs8" });
  const address = AccountAddress.fromBuffer(new Uint8Array(32).fill(byte).buffer);
  return {
    account: address.address,
    sign: message => signMessage(address, message, buildBasicAccountSigner(priv.subarray(priv.length - 32).toString("hex"))),
    accountInfo: {
      accountAddress: address,
      accountThreshold: 1,
      accountCredentials: {
        0: {
          value: {
            contents: {
              credentialPublicKeys: {
                keys: { 0: { verifyKey: pub.subarray(pub.length - 32).toString("hex"), schemeId: "Ed25519" } },
                threshold: 1,
              },
            },
          },
        },
      },
    },
  };
}

function registryFixture(badge, privateKey, ownerAccount) {
  const pubHex = privateKeyToAccount(privateKey).publicKey.slice(2);
  const cardHash = "a".repeat(64);
  return {
    check: {
      badge_valid: true,
      network: "testnet",
      token_address: badge,
      card_sha256: cardHash,
      checks: { hash_matches_on_chain: true },
      expected: { chain: "ccd:4221332d34e1694168c2a0c0b3fd0f27", contracts: { cis8004: "12802,0", cis8: "12801,0" } },
      on_chain: { status: "Active", agent_uri: "https://auditor.example/.well-known/agent-card.json", owner_account: ownerAccount, metadata_hash_hex: cardHash },
    },
    agent: {
      network: "testnet",
      token_address: badge,
      status: "Active",
      agent_uri: "https://auditor.example/.well-known/agent-card.json",
      owner_account: ownerAccount,
      metadata_hash_hex: cardHash,
      external_reference: {
        kind: "Cis8",
        contract_address: { index: 12801, subindex: 0 },
        key: { key_type: "secp256k1-uncompressed", namespace: "eip155:8453", public_key_hex: pubHex },
      },
    },
    binding: { status: "Active", owner: ownerAccount },
  };
}

const owner = makeWalletIdentity(0x61);
const identities = new Map([[owner.account, owner.accountInfo]]);
const registryMap = new Map([
  [INVITED_BADGE, registryFixture(INVITED_BADGE, INVITED_KEY, owner.account)],
  [OTHER_BADGE, registryFixture(OTHER_BADGE, OTHER_KEY, owner.account)],
  [UNINVITED_BADGE, registryFixture(UNINVITED_BADGE, UNINVITED_KEY, owner.account)],
]);

const VALID_REPORT = {
  title: "Reentrancy drain in ReentrancyVault.withdraw",
  location: "contracts/ReentrancyVault.sol#withdraw",
  rootCause: "ETH external call happens before zeroing balances[msg.sender].",
  impact: "Attacker drains all vault ETH in a single transaction.",
  invariant: "Single deposit cannot withdraw more than recorded balance.",
  reproduction: "Deploy ReentrancyVaultTest attacker helper and re-enter withdraw().",
  tools: "Foundry + custom local AI agent",
};

const VALID_POC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";

contract ReentrancyVaultTest is Test {
    function testExploitReentrancy() public {
        emit log("${EXPLOIT_ORACLE_MARKER}");
        assertTrue(true);
    }
}
`;

async function loginWallet(base, identity) {
  const ch = await (await fetch(`${base}/v1/auth/concordium/challenge`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ account: identity.account }),
  })).json();
  const res = await fetch(`${base}/v1/auth/concordium/verify`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ account: identity.account, challengeId: ch.challengeId, signature: await identity.sign(ch.message) }),
  });
  assert.equal(res.status, 200);
  return { cookie: res.headers.get("set-cookie").split(";")[0], csrf: (await res.json()).csrfToken };
}

async function startArbitraryTestServer(executeArbitraryOverride) {
  const defaultExec = async ({ programId, submissionId, sourceUrl, sourceRevision, pocFileName, pocSource, testContract }) => ({
    status: "reproduced",
    reason: "exploit oracle verified",
    exitCode: 0,
    output: `[PASS] testExploitReentrancy()\nLogs:\n  ${EXPLOIT_ORACLE_MARKER}\n`,
    errorOutput: "",
    imageId: `sha256:${"d".repeat(64)}`,
    receipt: {
      version: 1,
      kind: "arbitrary-poc-v1",
      programId,
      submissionId,
      sourceUrl,
      repoCommitSha: sourceRevision,
      testContract,
      pocFileName,
      pocSha256: createHash("sha256").update(pocSource).digest("hex"),
      status: "reproduced",
      reason: "exploit oracle verified",
      receiptHash: "e".repeat(64),
    },
  });

  const server = createApiServer({
    token: TOKEN,
    teamToken: TEAM_TOKEN,
    researcherToken: RESEARCHER_TOKEN,
    agentDomain: DOMAIN,
    invitedAgentBadges: [INVITED_BADGE, OTHER_BADGE],
    teamAccounts: [owner.account],
    lookupAccountInfo: async acc => identities.get(acc) ?? null,
    lookupAgent: async badge => {
      const entry = registryMap.get(badge);
      if (!entry) throw new Error("badge not found");
      return entry;
    },
    executeArbitrary: executeArbitraryOverride ?? defaultExec,
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    apiOrigin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}

async function createTeamArbitraryProgram(apiOrigin, teamCreds, overrides = {}) {
  const res = await fetch(`${apiOrigin}/v1/programs`, {
    method: "POST",
    headers: { origin: ORIGIN, cookie: teamCreds.cookie, "x-auditor-csrf": teamCreds.csrf, "content-type": "application/json" },
    body: JSON.stringify({
      name: "VeriPoC Vulnerable Contracts",
      sourceUrl: TARGET_REPO,
      sourceRevision: TARGET_COMMIT,
      chain: "evm-testnet",
      confidentiality: "members-only",
      visibility: "private",
      contact: "security@example.org",
      docsUrl: "",
      agentContext: "Run offline Foundry tests against contracts/.",
      rewardCurrency: "USD",
      rewardTiers: ["critical", "high", "medium", "low", "informational"].map(severity => ({ severity, min: 0, max: 0 })),
      references: [],
      permittedTargets: ["contracts/ReentrancyVault.sol"],
      rules: "Offline Foundry tests only against pinned commit.",
      exclusions: "Do not target external networks.",
      runLimit: 2,
      invitedResearcherAccounts: [],
      invitedAgentBadges: [INVITED_BADGE, OTHER_BADGE],
      ...overrides,
    }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).program;
}

test("dynamic team program supports authorized MCP PoC submission, isolated execution, owner inspection, and quota enforcement", async () => {
  const { apiOrigin, close } = await startArbitraryTestServer();
  try {
    const teamCreds = await loginWallet(apiOrigin, owner);
    const program = await createTeamArbitraryProgram(apiOrigin, teamCreds);

    const agentClient = createAgentGatewayClient({ apiOrigin, badge: INVITED_BADGE, domain: DOMAIN, privateKey: INVITED_KEY });
    const mcp = createMcpHandler(agentClient);

    const scopeResp = await mcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_program_scope", arguments: { programId: program.id } } });
    assert.equal(scopeResp.result.isError, false);
    const scope = JSON.parse(scopeResp.result.content[0].text);
    assert.equal(scope.program.sourceRevision, TARGET_COMMIT);

    const subResp = await mcp({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "submit_finding",
        arguments: {
          programId: program.id,
          targetRevision: TARGET_COMMIT,
          pocFileName: "ReentrancyVaultTest.t.sol",
          pocSource: VALID_POC,
          report: VALID_REPORT,
        },
      },
    });
    assert.equal(subResp.result.isError, false);
    const sub = JSON.parse(subResp.result.content[0].text);
    assert.equal(sub.targetRevision, TARGET_COMMIT);
    assert.equal(sub.pocFileName, "ReentrancyVaultTest.t.sol");

    const run1Resp = await mcp({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "verify_poc",
        arguments: { programId: program.id, submissionId: sub.id, testContract: "ReentrancyVaultTest" },
      },
    });
    assert.equal(run1Resp.result.isError, false);
    const run1 = JSON.parse(run1Resp.result.content[0].text);

    await new Promise(resolve => setTimeout(resolve, 25));

    const statusResp = await mcp({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "get_job_status", arguments: { programId: program.id, jobId: run1.id } },
    });
    const status = JSON.parse(statusResp.result.content[0].text);
    assert.equal(status.state, "finished");
    assert.equal(status.result.status, "reproduced");

    const evResp = await mcp({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "get_verification_evidence", arguments: { programId: program.id, jobId: run1.id } },
    });
    assert.equal(evResp.result.isError, false);
    const ev = JSON.parse(evResp.result.content[0].text);
    assert.equal(ev.status, "reproduced");
    assert.equal(ev.receipt.repoCommitSha, TARGET_COMMIT);
    assert.match(ev.output, /VERIPOC_ASSERT_EXPLOIT: true/);

    // Owner can inspect submissions, jobs, and private evidence
    const ownerEvRes = await fetch(`${apiOrigin}/v1/programs/${program.id}/jobs/${run1.id}/evidence`, {
      headers: { cookie: teamCreds.cookie },
    });
    assert.equal(ownerEvRes.status, 200);

    // Other invited agent cannot access Agent 1's evidence or run jobs against Agent 1's submission
    const otherClient = createAgentGatewayClient({ apiOrigin, badge: OTHER_BADGE, domain: DOMAIN, privateKey: OTHER_KEY });
    assert.equal((await otherClient.getVerificationEvidence({ programId: program.id, jobId: run1.id })).status, 404);
    assert.equal((await otherClient.verifyPoc({ programId: program.id, submissionId: sub.id, testContract: "ReentrancyVaultTest" })).status, 404);

    // Run 2 succeeds, run 3 hits runLimit (2) -> 429
    const run2 = await agentClient.verifyPoc({ programId: program.id, submissionId: sub.id, testContract: "ReentrancyVaultTest" });
    assert.equal(run2.status, 202);
    const run3 = await agentClient.verifyPoc({ programId: program.id, submissionId: sub.id, testContract: "ReentrancyVaultTest" });
    assert.equal(run3.status, 429);
  } finally {
    await close();
  }
});

test("dynamic team program rejects uninvited agents, commit mismatch, path traversal, vm.ffi, and public visitor submissions", async () => {
  const { apiOrigin, close } = await startArbitraryTestServer();
  try {
    const teamCreds = await loginWallet(apiOrigin, owner);
    const privateProg = await createTeamArbitraryProgram(apiOrigin, teamCreds);
    const publicProg = await createTeamArbitraryProgram(apiOrigin, teamCreds, {
      name: "Public Program",
      visibility: "public",
      invitedResearcherAccounts: [],
      invitedAgentBadges: [],
    });

    const uninvitedClient = createAgentGatewayClient({ apiOrigin, badge: UNINVITED_BADGE, domain: DOMAIN, privateKey: UNINVITED_KEY });
    assert.equal((await uninvitedClient.getProgramScope(privateProg.id)).status, 404);
    assert.equal((await uninvitedClient.submitFinding({
      programId: privateProg.id,
      targetRevision: TARGET_COMMIT,
      pocFileName: "ReentrancyVaultTest.t.sol",
      pocSource: VALID_POC,
      report: VALID_REPORT,
    })).status, 404);

    // Public program is readable by visitor, but anonymous/uninvited cannot submit
    const pubView = await fetch(`${apiOrigin}/v1/programs/${publicProg.id}`);
    assert.equal(pubView.status, 200);
    assert.equal((await uninvitedClient.submitFinding({
      programId: publicProg.id,
      targetRevision: TARGET_COMMIT,
      pocFileName: "ReentrancyVaultTest.t.sol",
      pocSource: VALID_POC,
      report: VALID_REPORT,
    })).status, 404);

    const agentClient = createAgentGatewayClient({ apiOrigin, badge: INVITED_BADGE, domain: DOMAIN, privateKey: INVITED_KEY });
    // Wrong commit SHA
    const badCommit = await agentClient.submitFinding({
      programId: privateProg.id,
      targetRevision: "0".repeat(40),
      pocFileName: "ReentrancyVaultTest.t.sol",
      pocSource: VALID_POC,
      report: VALID_REPORT,
    });
    assert.equal(badCommit.status, 400);

    // Path traversal pocFileName
    const badPath = await agentClient.submitFinding({
      programId: privateProg.id,
      targetRevision: TARGET_COMMIT,
      pocFileName: "../Evil.t.sol",
      pocSource: VALID_POC,
      report: VALID_REPORT,
    });
    assert.equal(badPath.status, 400);

    // Forbidden vm.ffi cheatcode
    const badCheat = await agentClient.submitFinding({
      programId: privateProg.id,
      targetRevision: TARGET_COMMIT,
      pocFileName: "Evil.t.sol",
      pocSource: VALID_POC.replace("assertTrue(true);", "vm.ffi(new string[](1));"),
      report: VALID_REPORT,
    });
    assert.equal(badCheat.status, 400);
  } finally {
    await close();
  }
});
