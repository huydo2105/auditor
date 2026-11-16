import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sources = JSON.parse(readFileSync(new URL("./public/data/public-sources.json", import.meta.url), "utf8"));

test("catalog has eight distinct pinned GitHub source references", () => {
  assert.equal(sources.length, 8);
  assert.equal(new Set(sources.map(source => source.id)).size, 8);
  assert.equal(sources.filter(source => source.kind === "protocol").length, 6);
  assert.equal(sources.filter(source => source.kind === "practice").length, 2);
  for (const source of sources) {
    assert.match(source.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
    assert.match(source.revision, /^[a-f0-9]{40}$/);
    assert.ok(source.title && source.owner && source.description);
    assert.ok(!JSON.stringify(source).match(/bounty|payout|authorized|verify|submit/i));
  }
});

test("catalog cards never route external sources to VeriPoC submission or execution", () => {
  const component = readFileSync(new URL("./components/opportunities/opportunity-list.tsx", import.meta.url), "utf8");
  assert.match(component, /github\.com\/\$\{source\.repository\}\/tree\/\$\{source\.revision\}/);
  assert.match(component, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(component, /fetch\(|type="file"|href="\/submit-report"|href="\/verify"/);
});
