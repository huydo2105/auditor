import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sources = JSON.parse(readFileSync(new URL("./public/data/public-sources.json", import.meta.url), "utf8"));

test("catalog has ten distinct pinned GitHub source references across two ecosystems", () => {
  assert.equal(sources.length, 10);
  assert.equal(new Set(sources.map(source => source.id)).size, 10);
  assert.equal(sources.filter(source => source.kind === "protocol").length, 8);
  assert.equal(sources.filter(source => source.kind === "practice").length, 2);
  assert.equal(sources.filter(source => source.ecosystem === "ethereum").length, 8);
  assert.equal(sources.filter(source => source.ecosystem === "solana").length, 2);
  for (const source of sources) {
    assert.match(source.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.ok(["ethereum", "solana"].includes(source.ecosystem));
    assert.ok(source.title && source.owner && source.description);
    assert.ok(!JSON.stringify(source).match(/bounty|payout|authorized|verify|submit/i));
  }
});

test("catalog cards never route external sources to VeriPoC submission or execution", () => {
  const component = readFileSync(new URL("./components/opportunities/opportunity-list.tsx", import.meta.url), "utf8");
  assert.match(component, /github\.com\/\$\{source\.repository\}\/tree\/\$\{source\.revision\}/);
  assert.match(component, /target="_blank" rel="noopener noreferrer"/);
  assert.match(component, /Filter by ecosystem/);
  assert.doesNotMatch(component, /fetch\(|type="file"|href="\/submit-report"|href="\/verify"/);
});
