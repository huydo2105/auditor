import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  arbitraryRunArgs,
  classifyArbitraryRun,
  EXPLOIT_ORACLE_MARKER,
  runArbitrarySubmission,
  validateArbitraryInput,
} from "./arbitrary-runner.mjs";

const COMMIT = "361349bae6c0b77bcdd7f66c2504063bbdab40a4";
const REPO_URL = "https://github.com/huydo2105/veripoc-vulnerable-contracts";
const IMAGE_ID = `sha256:${"a".repeat(64)}`;

const VALID_POC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "forge-std/Test.sol";
import "../contracts/ReentrancyVault.sol";

contract ReentrancyVaultTest is Test {
    function testExploitReentrancy() public {
        emit log("${EXPLOIT_ORACLE_MARKER}");
        assertTrue(true);
    }
}
`;

function makeLocalFixtureRepo() {
  const dir = mkdtempSync(join(tmpdir(), "auditor-local-repo-"));
  mkdirSync(join(dir, "contracts"), { recursive: true });
  writeFileSync(join(dir, "foundry.toml"), "[profile.default]\nsrc = \"contracts\"\n", "utf8");
  writeFileSync(join(dir, "contracts", "ReentrancyVault.sol"), "pragma solidity ^0.8.24;\ncontract ReentrancyVault {}\n", "utf8");
  return dir;
}

test("arbitraryRunArgs enforces network none, read-only root, dropped caps, non-root user, and offline forge test", () => {
  const args = arbitraryRunArgs(IMAGE_ID, "/tmp/ws", "ReentrancyVaultTest", "auditor-arb-1234");
  assert.ok(args.includes("--network") && args[args.indexOf("--network") + 1] === "none");
  assert.ok(args.includes("--read-only"));
  assert.ok(args.includes("--cap-drop") && args[args.indexOf("--cap-drop") + 1] === "ALL");
  assert.ok(args.includes("--security-opt") && args[args.indexOf("--security-opt") + 1] === "no-new-privileges");
  assert.ok(args.includes("--user") && args[args.indexOf("--user") + 1] === "10001:10001");
  assert.ok(args.includes("--offline"));
  assert.ok(args.includes("--match-contract") && args[args.indexOf("--match-contract") + 1] === "ReentrancyVaultTest");
  assert.ok(args.some(arg => arg.endsWith(":/workspace:ro")));
});

test("validateArbitraryInput rejects unsafe URLs, commits, path traversal filenames, oversized files, and forbidden cheatcodes", () => {
  assert.throws(
    () => validateArbitraryInput({
      sourceUrl: "https://evil.example.com/org/repo",
      sourceRevision: COMMIT,
      pocFileName: "Exploit.t.sol",
      testContract: "ExploitTest",
      pocSource: VALID_POC,
    }),
    /GitHub/,
  );

  assert.throws(
    () => validateArbitraryInput({
      sourceUrl: REPO_URL,
      sourceRevision: "main",
      pocFileName: "Exploit.t.sol",
      testContract: "ExploitTest",
      pocSource: VALID_POC,
    }),
    /40-character/,
  );

  for (const badName of ["../Evil.t.sol", "sub/Evil.t.sol", "Evil.sol", "a\\b.t.sol"]) {
    assert.throws(
      () => validateArbitraryInput({
        sourceUrl: REPO_URL,
        sourceRevision: COMMIT,
        pocFileName: badName,
        testContract: "ExploitTest",
        pocSource: VALID_POC,
      }),
      /pocFileName/,
    );
  }

  for (const cheat of ["vm.ffi(cmds);", 'vm.writeFile("/tmp/x", "y");', "vm.createSelectFork(\"https://rpc\");", "vm.readFile(\"/etc/passwd\");"]) {
    assert.throws(
      () => validateArbitraryInput({
        sourceUrl: REPO_URL,
        sourceRevision: COMMIT,
        pocFileName: "Exploit.t.sol",
        testContract: "ExploitTest",
        pocSource: VALID_POC.replace("assertTrue(true);", cheat),
      }),
      /forbidden Foundry cheatcodes/,
    );
  }

  assert.throws(
    () => validateArbitraryInput({
      sourceUrl: REPO_URL,
      sourceRevision: COMMIT,
      pocFileName: "Exploit.t.sol",
      testContract: "ExploitTest",
      pocSource: `${VALID_POC}\n// ${"x".repeat(33_000)}`,
    }),
    /32768/,
  );
});

test("classifyArbitraryRun distinguishes verified exploit marker, missing oracle marker, test failure, compile error, and timeout", () => {
  assert.equal(classifyArbitraryRun({ status: 0, stdout: `[PASS] testExploit()\nLogs:\n  ${EXPLOIT_ORACLE_MARKER}\n`, stderr: "" }).status, "reproduced");
  assert.equal(classifyArbitraryRun({ status: 0, stdout: "[PASS] testExploit()\n", stderr: "" }).status, "poc_passed_unverified_oracle");
  assert.equal(classifyArbitraryRun({ status: 1, stdout: "[FAIL: Assertion violated] testExploit()\n", stderr: "" }).status, "not_reproduced");
  assert.equal(classifyArbitraryRun({ status: 1, stdout: "", stderr: "Error: ParserError" }).status, "tool_error");
  assert.equal(classifyArbitraryRun({ status: null, error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" }).status, "inconclusive");
});

test("runArbitrarySubmission executes mocked hardened Docker run and cleans container on timeout", () => {
  const repoDir = makeLocalFixtureRepo();
  try {
    const calls = [];
    const okResult = runArbitrarySubmission({
      programId: "11111111-1111-4111-8111-111111111111",
      submissionId: "22222222-2222-4222-8222-222222222222",
      sourceUrl: REPO_URL,
      sourceRevision: COMMIT,
      pocFileName: "ReentrancyVaultTest.t.sol",
      testContract: "ReentrancyVaultTest",
      pocSource: VALID_POC,
      repoPath: repoDir,
      invoke: (cmd, args) => {
        calls.push({ cmd, args });
        if (args[0] === "image") return { status: 0, stdout: `${IMAGE_ID}\n`, stderr: "" };
        return { status: 0, stdout: `[PASS] testExploitReentrancy()\nLogs:\n  ${EXPLOIT_ORACLE_MARKER}\n`, stderr: "" };
      },
    });
    assert.equal(okResult.status, "reproduced");
    assert.equal(okResult.receipt.repoCommitSha, COMMIT);
    assert.match(okResult.receipt.receiptHash, /^[a-f0-9]{64}$/);
    assert.equal(calls.length, 2);

    const timeoutCalls = [];
    const timedOut = runArbitrarySubmission({
      sourceUrl: REPO_URL,
      sourceRevision: COMMIT,
      pocFileName: "ReentrancyVaultTest.t.sol",
      testContract: "ReentrancyVaultTest",
      pocSource: VALID_POC,
      repoPath: repoDir,
      invoke: (cmd, args) => {
        timeoutCalls.push({ cmd, args });
        if (args[0] === "image") return { status: 0, stdout: `${IMAGE_ID}\n`, stderr: "" };
        if (args[0] === "run") return { status: null, error: { code: "ETIMEDOUT" }, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(timedOut.status, "inconclusive");
    assert.equal(timeoutCalls.some(c => c.cmd === "docker" && c.args[0] === "rm" && c.args[1] === "-f"), true);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});
