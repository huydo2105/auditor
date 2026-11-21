type DraftValues = Record<string, string>;

async function teamSession(): Promise<{ csrfToken: string }> {
  const existing = await fetch("/v1/auth/me", { credentials: "same-origin", cache: "no-store" })
    .then(response => response.ok ? response.json() : null).catch(() => null);
  if (existing?.authenticated) return existing;

  const { detectConcordiumProvider } = await import("@concordium/browser-wallet-api-helpers");
  const provider = await detectConcordiumProvider(2000);
  const accounts = await provider.requestAccounts();
  const account = accounts?.[0];
  if (!account) throw new Error("Select a Concordium account in the wallet.");
  const challengeResponse = await fetch("/v1/auth/concordium/challenge", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account }),
  });
  const challenge = await challengeResponse.json();
  if (!challengeResponse.ok) throw new Error(challenge.error || "Could not request a wallet challenge.");
  const signature = await provider.signMessage(account, challenge.message);
  const verifyResponse = await fetch("/v1/auth/concordium/verify", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, challengeId: challenge.challengeId, signature }),
  });
  const session = await verifyResponse.json();
  if (!verifyResponse.ok) throw new Error(session.error || "Wallet signature could not be verified.");
  return session;
}

export async function publishProgram(values: DraftValues): Promise<string> {
  const targets = values.scope.trim().split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const runLimit = Number(values.runLimit);
  if (!/^[a-fA-F0-9]{40}([a-fA-F0-9]{24})?$/.test(values.sourceRevision.trim())
    || !["evm-local", "evm-testnet", "solana-testnet"].includes(values.chain.trim())
    || !Number.isInteger(runLimit) || runLimit < 1 || runLimit > 20 || targets.length > 10) {
    throw new Error("Check the source revision, chain, target list, and run limit before publishing.");
  }
  const session = await teamSession();
  const body = {
    name: values.name.trim(), sourceUrl: values.sourceUrl.trim(), sourceRevision: values.sourceRevision.trim(),
    chain: values.chain.trim(), confidentiality: "members-only", permittedTargets: targets,
    rules: [values.instructions, values.invariants, values.submission, values.agentRules, values.policy,
      values.rewards, values.eligibility].filter(Boolean).join("\n\n"),
    exclusions: values.outOfScope?.trim() || "No targets outside the permitted list.", runLimit,
    invitedResearcherAccounts: values.researcherAccount?.trim() ? [values.researcherAccount.trim()] : [],
    invitedAgentBadges: values.agentBadge?.trim() ? [values.agentBadge.trim()] : [],
  };
  const response = await fetch("/v1/programs", { method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-veripoc-csrf": session.csrfToken }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Program could not be saved.");
  return result.program.id;
}
