import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { isValidConcordiumAccount } from "./wallet-auth.mjs";

const bad = message => Object.assign(new Error(message), { status: 400 });
const text = (value, max) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const badge = value => typeof value === "string" && /^[1-9A-HJ-NP-Za-km-z]{15,40}$/.test(value);
const unique = values => new Set(values).size === values.length;

export function validateProgramDraft(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).sort().join() !== "chain,confidentiality,exclusions,invitedAgentBadges,invitedResearcherAccounts,name,permittedTargets,rules,runLimit,sourceRevision,sourceUrl")
    throw bad("invalid program fields");
  if (!text(body.name, 120) || !text(body.sourceRevision, 64)
    || !/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(body.sourceRevision)
    || !text(body.sourceUrl, 300) || !/^https:\/\/[^\s]+$/.test(body.sourceUrl)
    || !["evm-local", "evm-testnet", "solana-testnet"].includes(body.chain)
    || body.confidentiality !== "members-only" || !text(body.rules, 2000)
    || !text(body.exclusions, 2000) || !Number.isInteger(body.runLimit)
    || body.runLimit < 1 || body.runLimit > 20)
    throw bad("invalid program scope or rules");
  if (!Array.isArray(body.permittedTargets) || body.permittedTargets.length < 1 || body.permittedTargets.length > 10
    || body.permittedTargets.some(value => !text(value, 200)) || !unique(body.permittedTargets)
    || !Array.isArray(body.invitedResearcherAccounts) || body.invitedResearcherAccounts.length > 20
    || body.invitedResearcherAccounts.some(value => !isValidConcordiumAccount(value))
    || !unique(body.invitedResearcherAccounts)
    || !Array.isArray(body.invitedAgentBadges) || body.invitedAgentBadges.length > 20
    || body.invitedAgentBadges.some(value => !badge(value)) || !unique(body.invitedAgentBadges))
    throw bad("invalid targets or invitations");
  return {
    name: body.name.trim(), sourceUrl: body.sourceUrl.trim(), sourceRevision: body.sourceRevision.toLowerCase(),
    chain: body.chain, confidentiality: body.confidentiality, rules: body.rules.trim(), exclusions: body.exclusions.trim(),
    runLimit: body.runLimit, permittedTargets: body.permittedTargets.map(value => value.trim()),
    invitedResearcherAccounts: [...body.invitedResearcherAccounts], invitedAgentBadges: [...body.invitedAgentBadges],
  };
}

/** Single-process local store. Each mutation replaces one complete, fsynced snapshot. */
export function createProgramStore({ filePath = null, now = Date.now } = {}) {
  const path = filePath ? resolve(filePath) : null;
  let programs = [];
  if (path && existsSync(path)) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.version !== 1 || !Array.isArray(parsed.programs)) throw new Error("invalid program store");
    programs = parsed.programs;
  }
  const persist = next => {
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.${randomUUID()}.tmp`;
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ version: 1, programs: next }));
        fsyncSync(fd);
      } catch (error) {
        closeSync(fd);
        try { unlinkSync(temporary); } catch {}
        throw error;
      }
      closeSync(fd);
      try { renameSync(temporary, path); }
      catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
    }
    programs = next;
  };
  return {
    list: () => programs.map(item => structuredClone(item)),
    get: id => structuredClone(programs.find(item => item.id === id) ?? null),
    create: (ownerAccount, body) => {
      if (!isValidConcordiumAccount(ownerAccount)) throw bad("valid owner account required");
      if (programs.length >= 100) throw Object.assign(new Error("program capacity reached"), { status: 503 });
      const draft = validateProgramDraft(body);
      if (draft.invitedResearcherAccounts.includes(ownerAccount)) throw bad("owner cannot invite itself");
      const item = { id: randomUUID(), ownerAccount, ...draft, status: "active", verification: "not-configured",
        createdAt: new Date(now()).toISOString(), reportIds: [], jobIds: [] };
      persist([...programs, item]);
      return structuredClone(item);
    },
    changeInvitation: (id, kind, value, action) => {
      const index = programs.findIndex(item => item.id === id);
      if (index < 0) return null;
      if (!["invite", "revoke"].includes(action)) throw bad("invalid invitation action");
      const field = kind === "researcher-account" ? "invitedResearcherAccounts" : kind === "agent-badge" ? "invitedAgentBadges" : null;
      if (!field || !(field === "invitedResearcherAccounts" ? isValidConcordiumAccount(value) : badge(value))) throw bad("invalid invitation");
      const item = structuredClone(programs[index]);
      if (item.status === "closed" || value === item.ownerAccount) throw bad("invitation not allowed");
      item[field] = action === "invite" ? [...new Set([...item[field], value])] : item[field].filter(entry => entry !== value);
      persist(programs.map((entry, i) => i === index ? item : entry));
      return structuredClone(item);
    },
    changeStatus: (id, status) => {
      const index = programs.findIndex(item => item.id === id);
      if (index < 0) return null;
      if (!["active", "paused", "closed"].includes(status) || programs[index].status === "closed") throw bad("invalid status transition");
      const item = { ...programs[index], status };
      persist(programs.map((entry, i) => i === index ? item : entry));
      return structuredClone(item);
    },
  };
}
