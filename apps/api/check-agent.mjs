import { lookupConcordiumAgent } from "./agent-auth.mjs";

const badge = process.argv[2];
if (!badge) throw new Error("usage: node apps/api/check-agent.mjs <invited-badge>");
const { check, agent, binding } = await lookupConcordiumAgent(badge);
const valid = check.badge_valid === true && agent.status === "Active"
  && binding?.status === "Active" && binding.owner === agent.owner_account
  && check.card_sha256 === agent.metadata_hash_hex;
console.log(JSON.stringify({ badge, valid, network: agent.network,
  badgeActive: agent.status === "Active", cardHashMatches: check.card_sha256 === agent.metadata_hash_hex,
  keyBoundToOwner: binding?.status === "Active" && binding.owner === agent.owner_account }, null, 2));
if (!valid) process.exitCode = 1;
