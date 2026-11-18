import test from "node:test";
import assert from "node:assert/strict";
import { createApiServer } from "../../api/server.mjs";
import { GET, POST } from "../app/v1/[...segments]/route";

const token = "test-token-with-at-least-thirty-two-characters";
const teamToken = "test-team-token-with-at-least-thirty-two-characters";
const researcherToken = "test-researcher-token-with-at-least-thirty-two-characters";
const context = (...segments: string[]) => ({ params: Promise.resolve({ segments }) });

test("same-origin proxy forwards only allowed verification requests and backend auth", async () => {
  // The existing JavaScript API infers its options from a default empty object.
  // @ts-expect-error token is required and validated by createApiServer at runtime.
  const server = createApiServer({ token, teamToken, researcherToken, execute: async () => ({ status: "tool_error", reason: "test executor" }) });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const oldOrigin = process.env.VERIPOC_API_ORIGIN;
  process.env.VERIPOC_API_ORIGIN = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const request = (fixture: string, auth = token, key = "proxytestkey") => new Request("http://localhost:3000/v1/verify-poc", {
      method: "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ artifactFormat: "repo-fixture-v1", fixture }),
    });
    const denied = await POST(request("vulnerable", "wrong", "proxydenied"), context("verify-poc"));
    assert.equal(denied.status, 401);
    const invalid = await POST(request("external", token, "proxyinvalid"), context("verify-poc"));
    assert.equal(invalid.status, 400);
    const accepted = await POST(request("vulnerable"), context("verify-poc"));
    assert.equal(accepted.status, 202);
    const job = await accepted.json();
    assert.match(job.id, /^[a-f0-9-]{36}$/);
    const status = await GET(new Request(`http://localhost:3000/v1/jobs/${job.id}`, { headers: { authorization: `Bearer ${token}` } }), context("jobs", job.id));
    assert.equal(status.status, 200);
    assert.equal((await status.json()).fixture, "vulnerable");
    assert.equal((await POST(request("vulnerable"), context("scan"))).status, 404);
    assert.equal((await GET(new Request("http://localhost:3000/v1/jobs/../bad"), context("jobs", "../bad"))).status, 404);
    assert.equal((await POST(request("x".repeat(5000), token, "proxylarge"), context("verify-poc"))).status, 413);
    const scopePath = "http://localhost:3000/v1/programs/demo-vault";
    assert.equal((await GET(new Request(scopePath, { headers: { authorization: `Bearer ${token}` } }), context("programs", "demo-vault"))).status, 401);
    const scope = await GET(new Request(scopePath, { headers: { authorization: `Bearer ${teamToken}` } }), context("programs", "demo-vault"));
    assert.equal((await scope.json()).actor.role, "team");
    const submitted = await POST(new Request(`${scopePath}/submissions`, { method: "POST", headers: {
      authorization: `Bearer ${researcherToken}`, "content-type": "application/json", "idempotency-key": "proxy-claim-key" },
      body: JSON.stringify({ claim: "donation-share-inflation", targetSha256: "0151b8d3c7e0dfa8cb1851f4663761e06c4e676c50df31b0acd1baf4acfa1eb1" }),
    }), context("programs", "demo-vault", "submissions"));
    assert.equal(submitted.status, 201);
    assert.equal((await POST(request("vulnerable", researcherToken, "role-legacy-key"), context("verify-poc"))).status, 401);
  } finally {
    if (oldOrigin === undefined) delete process.env.VERIPOC_API_ORIGIN;
    else process.env.VERIPOC_API_ORIGIN = oldOrigin;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
