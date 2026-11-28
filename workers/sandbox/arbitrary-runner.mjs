import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { IMAGE } from "./runner.mjs";

export const ARBITRARY_IMAGE = process.env.AUDITOR_WORKER_IMAGE ?? IMAGE;
export const MAX_POC_BYTES = 32_768;
export const EXPLOIT_ORACLE_MARKER = "VERIPOC_ASSERT_EXPLOIT: true";

const GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const COMMIT_SHA_RE = /^[a-fA-F0-9]{40}$/;
const POC_FILE_RE = /^[A-Za-z0-9_]{1,48}\.t\.sol$/;
const CONTRACT_NAME_RE = /^[A-Za-z0-9_]{1,64}$/;
const FORBIDDEN_CHEATCODE_RE = /\b(?:vm|Vm)\.(?:ffi|tryFfi|writeFile|writeLine|readFile|readLine|removeFile|createDir|removeDir|createFork|createSelectFork|selectFork|rollFork|rpcUrl|unixTime)\b/;
const FORBIDDEN_FFI_CALL_RE = /\bffi\s*\(/;
const FORBIDDEN_HEVM_RE = /keccak256\s*\(\s*["']hevm cheat code["']\s*\)/i;

const bad = message => Object.assign(new Error(message), { status: 400 });
const sha = value => createHash("sha256").update(value).digest("hex");

function clean(output) {
  return String(output ?? "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "")
    .slice(0, 65_536);
}

export function validateGitHubSourceUrl(sourceUrl) {
  if (typeof sourceUrl !== "string" || sourceUrl.length > 300) {
    throw bad("sourceUrl must be a valid GitHub repository URL");
  }
  const match = GITHUB_URL_RE.exec(sourceUrl.trim());
  if (!match) throw bad("sourceUrl must match https://github.com/<owner>/<repo>");
  const [, owner, repo] = match;
  if (owner === "." || owner === ".." || owner.includes("..") || repo === "." || repo === ".." || repo.includes("..")) {
    throw bad("sourceUrl contains invalid path segments");
  }
  return `https://github.com/${owner}/${repo}`;
}

export function validateCommitSha(sourceRevision) {
  if (typeof sourceRevision !== "string" || !COMMIT_SHA_RE.test(sourceRevision.trim())) {
    throw bad("sourceRevision must be a 40-character hexadecimal git commit SHA");
  }
  return sourceRevision.trim().toLowerCase();
}

export function validatePocFileName(pocFileName) {
  if (typeof pocFileName !== "string" || !POC_FILE_RE.test(pocFileName)) {
    throw bad("pocFileName must match <Name>.t.sol using only alphanumeric characters or underscores");
  }
  return pocFileName;
}

export function validateTestContract(testContract) {
  if (typeof testContract !== "string" || !CONTRACT_NAME_RE.test(testContract)) {
    throw bad("testContract must be a valid Solidity contract identifier");
  }
  return testContract;
}

export function validatePocSource(pocSource) {
  if (typeof pocSource !== "string" || !pocSource.trim()) {
    throw bad("pocSource must be a non-empty Solidity test file");
  }
  if (pocSource.includes("\0")) {
    throw bad("pocSource cannot contain null bytes");
  }
  if (Buffer.byteLength(pocSource, "utf8") > MAX_POC_BYTES) {
    throw bad(`pocSource exceeds maximum ${MAX_POC_BYTES} bytes`);
  }
  if (!/\bcontract\s+[A-Za-z_][A-Za-z0-9_]*/.test(pocSource)) {
    throw bad("pocSource must declare a Solidity contract");
  }
  if (!/\bfunction\s+test[A-Za-z0-9_]*\s*\(/.test(pocSource)) {
    throw bad("pocSource must define a Foundry test function starting with test");
  }
  if (FORBIDDEN_CHEATCODE_RE.test(pocSource) || FORBIDDEN_FFI_CALL_RE.test(pocSource) || FORBIDDEN_HEVM_RE.test(pocSource)) {
    throw bad("pocSource contains forbidden Foundry cheatcodes or filesystem/network calls");
  }
  return pocSource;
}

export function validateArbitraryInput({ sourceUrl, sourceRevision, pocFileName, pocSource, testContract }) {
  return {
    sourceUrl: validateGitHubSourceUrl(sourceUrl),
    sourceRevision: validateCommitSha(sourceRevision),
    pocFileName: validatePocFileName(pocFileName),
    testContract: validateTestContract(testContract),
    pocSource: validatePocSource(pocSource),
  };
}

export function arbitraryRunArgs(imageId, workspaceDir, testContract, containerName = `auditor-arb-${randomUUID()}`) {
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("invalid image ID");
  validateTestContract(testContract);
  if (!/^auditor-arb-[a-f0-9-]+$/.test(containerName)) throw new Error("invalid container name");
  const resolvedDir = resolve(workspaceDir);
  return [
    "run", "--rm", "--name", containerName, "--init",
    "--network", "none", "--read-only",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
    "--pids-limit", "64", "--memory", "512m", "--cpus", "1",
    "--user", "10001:10001",
    "--tmpfs", "/tmp:rw,noexec,nosuid,size=128m,mode=1777",
    "--env", "HOME=/tmp",
    "--env", "FOUNDRY_OUT=/tmp/out",
    "--env", "FOUNDRY_CACHE_PATH=/tmp/cache",
    "--env", "FOUNDRY_FUZZ_RUNS=1",
    "-v", `${resolvedDir}:/workspace:ro`,
    "-w", "/workspace",
    "--entrypoint", "forge",
    imageId,
    "test", "--offline", "--no-match-path", "lib/**",
    "--match-contract", testContract, "-vvv",
  ];
}

export function classifyArbitraryRun(result) {
  const timedOut = result.error?.code === "ETIMEDOUT";
  const aborted = result.error?.code === "ABORT_ERR";
  const output = clean(result.stdout);
  const errorOutput = clean(result.stderr);
  if (timedOut) {
    return { status: "inconclusive", reason: "timeout", exitCode: result.status, output, errorOutput };
  }
  if (aborted) {
    return { status: "inconclusive", reason: "aborted", exitCode: result.status, output, errorOutput };
  }
  if (result.status === 0) {
    if (output.includes(EXPLOIT_ORACLE_MARKER)) {
      return { status: "reproduced", reason: "exploit oracle verified", exitCode: 0, output, errorOutput };
    }
    return {
      status: "poc_passed_unverified_oracle",
      reason: `test passed without ${EXPLOIT_ORACLE_MARKER} marker`,
      exitCode: 0,
      output,
      errorOutput,
    };
  }
  if (/\[FAIL/i.test(output)) {
    return { status: "not_reproduced", reason: "poc test failed or reverted", exitCode: result.status, output, errorOutput };
  }
  return { status: "tool_error", reason: "foundry failed", exitCode: result.status, output, errorOutput };
}

function buildReceipt({
  programId = null,
  submissionId = null,
  sourceUrl,
  sourceRevision,
  testContract,
  pocFileName,
  pocSha256,
  classified,
}) {
  const payload = {
    version: 1,
    kind: "arbitrary-poc-v1",
    ...(programId ? { programId } : {}),
    ...(submissionId ? { submissionId } : {}),
    sourceUrl,
    repoCommitSha: sourceRevision,
    testContract,
    pocFileName,
    pocSha256,
    status: classified.status,
    reason: classified.reason,
    executionLogSha256: sha(`${classified.output}\n${classified.errorOutput}`),
  };
  const receiptHash = sha(`Auditor arbitrary receipt v1\n${JSON.stringify(payload)}`);
  return { ...payload, receiptHash };
}

function prepareWorkspace({ sourceUrl, sourceRevision, pocFileName, pocSource, repoPath, invoke }) {
  const tempRoot = mkdtempSync(join(tmpdir(), "auditor-arb-ws-"));
  const workspaceDir = join(tempRoot, "repo");
  try {
    if (repoPath) {
      cpSync(resolve(repoPath), workspaceDir, { recursive: true, dereference: false });
    } else {
      mkdirSync(workspaceDir, { recursive: true });
      const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
      const init = invoke("git", ["init", workspaceDir], { encoding: "utf8", timeout: 10_000, env: gitEnv });
      if (init.status !== 0) throw new Error(`git init failed: ${clean(init.stderr)}`);
      const remote = invoke("git", ["-C", workspaceDir, "remote", "add", "origin", sourceUrl], { encoding: "utf8", timeout: 10_000, env: gitEnv });
      if (remote.status !== 0) throw new Error(`git remote failed: ${clean(remote.stderr)}`);
      let fetched = invoke("git", ["-C", workspaceDir, "fetch", "--depth", "1", "origin", sourceRevision], {
        encoding: "utf8", timeout: 60_000, env: gitEnv,
      });
      if (fetched.status !== 0) {
        fetched = invoke("git", ["-C", workspaceDir, "fetch", "origin"], { encoding: "utf8", timeout: 60_000, env: gitEnv });
        if (fetched.status !== 0) throw new Error(`git fetch failed: ${clean(fetched.stderr)}`);
      }
      const checkout = invoke("git", ["-C", workspaceDir, "checkout", "--detach", sourceRevision], {
        encoding: "utf8", timeout: 20_000, env: gitEnv,
      });
      if (checkout.status !== 0) throw new Error(`git checkout failed: ${clean(checkout.stderr)}`);
      const rev = invoke("git", ["-C", workspaceDir, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 10_000, env: gitEnv });
      if (rev.status !== 0 || String(rev.stdout ?? "").trim().toLowerCase() !== sourceRevision) {
        throw new Error("checked out commit does not match pinned sourceRevision");
      }
      rmSync(join(workspaceDir, ".git"), { recursive: true, force: true });
    }

    const testDir = join(workspaceDir, "test");
    mkdirSync(testDir, { recursive: true });
    const pocPath = join(testDir, pocFileName);
    writeFileSync(pocPath, pocSource, "utf8");
    try {
      chmodSync(workspaceDir, 0o755);
      chmodSync(testDir, 0o755);
      chmodSync(pocPath, 0o644);
    } catch {
      // Windows permissions differ from POSIX; Docker Desktop/Linux still enforces container isolation.
    }
    return { tempRoot, workspaceDir };
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export function runArbitrarySubmission({
  programId = null,
  submissionId = null,
  sourceUrl,
  sourceRevision,
  pocFileName,
  pocSource,
  testContract,
  repoPath = null,
  image = ARBITRARY_IMAGE,
  timeoutMs = 45_000,
  invoke = spawnSync,
} = {}) {
  const valid = validateArbitraryInput({ sourceUrl, sourceRevision, pocFileName, pocSource, testContract });
  const pocSha256 = sha(valid.pocSource);
  const { tempRoot, workspaceDir } = prepareWorkspace({ ...valid, repoPath, invoke });

  try {
    const inspect = invoke("docker", ["image", "inspect", image, "--format", "{{.Id}}"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 65_536,
    });
    if (inspect.status !== 0) {
      const classified = classifyArbitraryRun({ ...inspect, stdout: "" });
      const receipt = buildReceipt({ programId, submissionId, ...valid, pocSha256, classified });
      return { ...classified, imageId: null, receipt };
    }
    const imageId = String(inspect.stdout ?? "").trim();
    const containerName = `auditor-arb-${randomUUID()}`;
    const args = arbitraryRunArgs(imageId, workspaceDir, valid.testContract, containerName);
    const run = invoke("docker", args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 262_144,
    });
    if (run.error?.code === "ETIMEDOUT" || run.error?.code === "ABORT_ERR") {
      invoke("docker", ["rm", "-f", containerName], { encoding: "utf8", timeout: 5000 });
    }
    const classified = classifyArbitraryRun(run);
    const receipt = buildReceipt({ programId, submissionId, ...valid, pocSha256, classified });
    return { ...classified, imageId, receipt };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}
