"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Award, Bot, CheckCircle2, Coins, FileCode2, Inbox, RefreshCw, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";

type FilterCategory = "all" | "new_finding" | "status_change" | "payment" | "badge";
type TriageDecision = "accept" | "reject" | "needs_info";

type InboxJob = {
  id: string;
  fixture: "vulnerable" | "patched";
  state: "queued" | "running" | "finished";
  isPatchRetest?: boolean;
  verdict: string | null;
  receiptHash: string | null;
  anchor?: {
    txHash: string;
    network: string;
    anchoredAt: string;
    explorerUrl: string;
  } | null;
  result?: {
    status: string;
    exitCode?: number | null;
    reason?: string;
    receipt?: { receiptHash?: string };
    financialEvidence?: { attackerBefore: string; attackerAfter: string; victimShares: string } | null;
  } | null;
};

type AdvisoryNote = {
  id: string;
  authorId: string;
  createdAt: string;
  summary: string;
  suggestedDecision: TriageDecision;
  suggestedPatch?: string;
  confidence: string;
  advisory: true;
  canFinalize: false;
};

type InboxSubmission = {
  id: string;
  programId: string;
  authorId: string;
  claim: string;
  targetSha256: string;
  createdAt?: string;
  report?: {
    title: string;
    location: string;
    rootCause: string;
    impact: string;
    invariant: string;
    reproduction: string;
    tools?: string;
  };
  advisoryNotes: AdvisoryNote[];
  triage: { decision: TriageDecision; rationale: string; decidedBy: string; decidedAt: string } | null;
  jobs: InboxJob[];
  patchRetestJobs: InboxJob[];
  settlement?: {
    settled: true;
    txHash: string;
    amount: string;
    asset: string;
    network: string;
    explorerUrl?: string;
    settledAt: string;
  } | null;
};

type InboxItem = {
  id: string;
  category: Exclude<FilterCategory, "all">;
  programId: string;
  submissionId: string;
  jobId?: string;
  title: string;
  summary: string;
  actorId: string;
  createdAt: string;
  status: string;
};

type InboxResponse = {
  actor: { id: string; role: "team" | "researcher"; account?: string };
  counts: Record<FilterCategory, number>;
  items: InboxItem[];
  submissions: InboxSubmission[];
};

const FILTERS: { id: FilterCategory; label: string }[] = [
  { id: "all", label: "All inbox" },
  { id: "new_finding", label: "New findings" },
  { id: "status_change", label: "Status changes" },
  { id: "payment", label: "Payments" },
  { id: "badge", label: "Badges" },
];

export function TeamInbox() {
  const [token, setToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [useCookie, setUseCookie] = useState(true);
  const [data, setData] = useState<InboxResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<FilterCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);

  const [noteSummary, setNoteSummary] = useState("");
  const [noteDecision, setNoteDecision] = useState<TriageDecision>("accept");
  const [notePatch, setNotePatch] = useState("");
  const [triageRationale, setTriageRationale] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const authHeaders = useCallback((): Record<string, string> => {
    return token ? { authorization: `Bearer ${token}` } : {};
  }, [token]);

  const loadInbox = useCallback(async (withSpinner = true) => {
    if (withSpinner) setLoading(true);
    setError("");
    try {
      const res = await fetch("/v1/inbox", {
        credentials: "same-origin",
        cache: "no-store",
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          setData(null);
          setError(token ? "Bearer token rejected. Check your team or researcher token." : "");
        } else {
          setError(json.error || "Unable to load private inbox.");
        }
        return;
      }
      setData(json as InboxResponse);
      setSelectedSubId(prev => prev ?? json.submissions?.[0]?.id ?? null);
    } catch {
      setError("Verification API is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, token]);

  useEffect(() => {
    if (!useCookie && !token) return;
    let active = true;
    fetch("/v1/inbox", { credentials: "same-origin", cache: "no-store", headers: authHeaders() })
      .then(async res => ({ ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) }))
      .then(({ ok, status, json }) => {
        if (!active) return;
        if (!ok) {
          if (status === 401) {
            setData(null);
            setError(token ? "Bearer token rejected. Check your team or researcher token." : "");
          } else {
            setError(json.error || "Unable to load private inbox.");
          }
          return;
        }
        setData(json as InboxResponse);
        setSelectedSubId(prev => prev ?? json.submissions?.[0]?.id ?? null);
      })
      .catch(() => { if (active) setError("Verification API is unavailable."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [authHeaders, useCookie, token]);

  function submitToken(event: FormEvent) {
    event.preventDefault();
    setUseCookie(false);
    setToken(tokenDraft.trim());
  }

  const visibleItems = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.items.filter(item => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      return `${item.title} ${item.summary} ${item.actorId}`.toLowerCase().includes(q);
    });
  }, [data, category, query]);

  const activeSubmission = useMemo(() => {
    if (!data?.submissions?.length) return null;
    return data.submissions.find(s => s.id === selectedSubId) ?? data.submissions[0];
  }, [data, selectedSubId]);

  const hasActiveJobs = useMemo(() => {
    if (!activeSubmission) return false;
    return [...activeSubmission.jobs, ...activeSubmission.patchRetestJobs].some(
      job => job.state === "queued" || job.state === "running",
    );
  }, [activeSubmission]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setTimeout(() => { void loadInbox(); }, 500);
    return () => clearTimeout(timer);
  }, [hasActiveJobs, loadInbox]);

  async function postTeamAction(subId: string, endpoint: string, body?: object, extraHeaders: Record<string, string> = {}) {
    setBusyAction(endpoint);
    setActionMessage("");
    setError("");
    try {
      const headers: Record<string, string> = {
        ...authHeaders(),
        "content-type": "application/json",
        ...extraHeaders,
      };
      const res = await fetch(`/v1/programs/demo-vault/submissions/${subId}/${endpoint}`, {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || `Request to ${endpoint} failed.`);
        return;
      }
      setActionMessage(`Updated submission (${endpoint}).`);
      await loadInbox();
    } catch {
      setError("Verification API is unavailable.");
    } finally {
      setBusyAction("");
    }
  }

  async function submitAdvisoryNote(event: FormEvent) {
    event.preventDefault();
    if (!activeSubmission || !noteSummary.trim()) return;
    await postTeamAction(activeSubmission.id, "agent-note", {
      summary: noteSummary.trim(),
      suggestedDecision: noteDecision,
      ...(notePatch.trim() ? { suggestedPatch: notePatch.trim() } : {}),
      confidence: "high",
    });
    setNoteSummary("");
    setNotePatch("");
  }

  async function submitTriage(decision: TriageDecision) {
    if (!activeSubmission) return;
    const rationale = triageRationale.trim() || `Team marked finding as ${decision} after reviewing Foundry evidence.`;
    await postTeamAction(activeSubmission.id, "triage", { decision, rationale });
  }

  async function triggerPatchRetest() {
    if (!activeSubmission) return;
    const idempotencyKey = `retest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await postTeamAction(activeSubmission.id, "patch-retest", {}, { "idempotency-key": idempotencyKey });
  }

  return (
    <main id="main" className="site-shell inbox-page">
      <div className="inbox-top">
        <div>
          <p className="eyebrow">PRIVATE PROGRAM INBOX</p>
          <h1>Findings, private receipts &amp; triage</h1>
        </div>
        <button type="button" className="report-secondary focus-ring" onClick={() => void loadInbox()} disabled={loading}>
          <RefreshCw size={15} aria-hidden="true" /> Refresh
        </button>
      </div>

      {!data && (
        <section className="inbox-auth-card" aria-label="Authorize inbox access">
          <h2>Open private inbox</h2>
          <p>Sign in with your Concordium team/researcher wallet from the header, or enter your local API role token below (held in page memory only).</p>
          <form className="inbox-token-form" onSubmit={submitToken}>
            <label htmlFor="inbox-token-input">Local program token</label>
            <div className="inbox-token-row">
              <input
                id="inbox-token-input"
                type="password"
                value={tokenDraft}
                onChange={e => setTokenDraft(e.target.value)}
                placeholder="Paste team or researcher token"
              />
              <button type="submit" className="site-action site-action-dark focus-ring" disabled={!tokenDraft.trim()}>
                Open inbox
              </button>
            </div>
          </form>
          {error && <p role="alert" className="verification-error rounded-lg p-3 text-sm mt-3" data-testid="inbox-error">{error}</p>}
        </section>
      )}

      {data && (
        <div className="inbox-layout">
          <aside className="inbox-sidebar" aria-label="Inbox navigation and filters">
            <div className="inbox-role-card" data-testid="inbox-actor-banner">
              <ShieldCheck size={16} aria-hidden="true" />
              <div>
                <strong>{data.actor.role === "team" ? "Team Reviewer" : "Invited Researcher"}</strong>
                <span className="mono-data">{data.actor.id}</span>
              </div>
            </div>

            <nav className="inbox-nav" aria-label="Workspace views">
              <Link href="/inbox" className="inbox-nav-link is-active focus-ring"><Inbox size={15} aria-hidden="true" /> Inbox</Link>
              <Link href="/profile/projects" className="inbox-nav-link focus-ring"><SlidersHorizontal size={15} aria-hidden="true" /> My bounties</Link>
              <Link href="/teams/new" className="inbox-nav-link focus-ring"><Coins size={15} aria-hidden="true" /> Create bounty</Link>
            </nav>

            <div className="inbox-filters" role="group" aria-label="Filter inbox items">
              <span className="inbox-filters-heading">Filters</span>
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  type="button"
                  className={`inbox-filter-btn focus-ring${category === f.id ? " is-active" : ""}`}
                  aria-pressed={category === f.id}
                  onClick={() => setCategory(f.id)}
                >
                  <span>{f.label}</span>
                  <span className="inbox-count">{data.counts[f.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </aside>

          <section className="inbox-main" aria-label="Private notifications and submission timeline">
            <div className="inbox-search-row">
              <div className="faq-search-wrap">
                <Search size={16} aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search findings, receipts, agent badges…"
                  aria-label="Search notifications"
                />
              </div>
            </div>

            {error && <p role="alert" className="verification-error rounded-lg p-3 text-sm mb-4" data-testid="inbox-error">{error}</p>}
            {actionMessage && <p role="status" className="inbox-status-ok">{actionMessage}</p>}

            {visibleItems.length === 0 ? (
              <div className="inbox-empty" role="status">
                <p>No private notifications match this filter yet.</p>
              </div>
            ) : (
              <ul className="inbox-list" aria-label="Inbox items">
                {visibleItems.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`inbox-item-btn focus-ring${activeSubmission?.id === item.submissionId ? " is-selected" : ""}`}
                      onClick={() => setSelectedSubId(item.submissionId)}
                    >
                      <span className="inbox-item-title">{item.title}</span>
                      <span className="inbox-item-summary">{item.summary}</span>
                      <span className="inbox-item-meta">
                        <span>{item.actorId}</span>
                        <span>{item.status}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {activeSubmission && (
              <article className="inbox-timeline-card" aria-label="Submission verification timeline">
                <div className="inbox-timeline-head">
                  <div>
                    <span className="eyebrow">{activeSubmission.programId}</span>
                    <h2>{activeSubmission.report?.title ?? `Submission: ${activeSubmission.claim}`}</h2>
                  </div>
                  <span className="status-chip">
                    {activeSubmission.triage ? `Decision: ${activeSubmission.triage.decision}` : "Pending team review"}
                  </span>
                </div>

                {activeSubmission.report && (
                  <dl className="inbox-report-dl">
                    <div><dt>Location</dt><dd className="mono-data">{activeSubmission.report.location}</dd></div>
                    <div><dt>Root cause</dt><dd>{activeSubmission.report.rootCause}</dd></div>
                    <div><dt>Impact</dt><dd>{activeSubmission.report.impact}</dd></div>
                    <div><dt>Invariant</dt><dd>{activeSubmission.report.invariant}</dd></div>
                    <div><dt>Reproduction</dt><dd>{activeSubmission.report.reproduction}</dd></div>
                  </dl>
                )}

                <ol className="inbox-timeline" aria-label="Verification lifecycle steps">
                  <li className="timeline-step">
                    <Award size={16} aria-hidden="true" />
                    <div>
                      <strong>1. Researcher / Agent Identity</strong>
                      <p className="mono-data">{activeSubmission.authorId} · target {activeSubmission.targetSha256.slice(0, 16)}…</p>
                    </div>
                  </li>

                  <li className="timeline-step">
                    <FileCode2 size={16} aria-hidden="true" />
                    <div>
                      <strong>2. Exploit Reproduction Evidence</strong>
                      {activeSubmission.jobs.length === 0 ? (
                        <p>No exploit verification job run yet.</p>
                      ) : activeSubmission.jobs.map(job => (
                        <p key={job.id} className="mono-data">
                          Job {job.id.slice(0, 8)}… ({job.fixture}) → {job.verdict ?? job.state}
                          {job.receiptHash ? ` · receipt ${job.receiptHash.slice(0, 16)}…` : ""}
                        </p>
                      ))}
                    </div>
                  </li>

                  <li className="timeline-step">
                    <Bot size={16} aria-hidden="true" />
                    <div>
                      <strong>3. Advisory Team-Agent Notes (cannot finalize decisions)</strong>
                      {activeSubmission.advisoryNotes.length === 0 ? (
                        <p>No team-agent summary posted yet.</p>
                      ) : activeSubmission.advisoryNotes.map(note => (
                        <div key={note.id} className="advisory-note-box">
                          <span className="status-chip">Advisory only · Suggests: {note.suggestedDecision}</span>
                          <p>{note.summary}</p>
                          {note.suggestedPatch && <pre className="mono-data">{note.suggestedPatch}</pre>}
                        </div>
                      ))}

                      {data.actor.role === "team" && (
                        <form className="inbox-subform" onSubmit={submitAdvisoryNote}>
                          <label htmlFor="advisory-summary">Team agent advisory summary</label>
                          <textarea
                            id="advisory-summary"
                            rows={2}
                            value={noteSummary}
                            onChange={e => setNoteSummary(e.target.value)}
                            placeholder="Summarize receipt evidence and root cause (advisory only)"
                          />
                          <div className="inbox-subform-row">
                            <select aria-label="Suggested decision" value={noteDecision} onChange={e => setNoteDecision(e.target.value as TriageDecision)}>
                              <option value="accept">Suggest: accept</option>
                              <option value="needs_info">Suggest: needs_info</option>
                              <option value="reject">Suggest: reject</option>
                            </select>
                            <input
                              aria-label="Suggested patch note"
                              value={notePatch}
                              onChange={e => setNotePatch(e.target.value)}
                              placeholder="Optional patch hint (e.g. VIRTUAL_SHARES)"
                            />
                            <button type="submit" className="report-secondary focus-ring" disabled={Boolean(busyAction) || !noteSummary.trim()}>
                              Post advisory note
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  </li>

                  <li className="timeline-step">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <div>
                      <strong>4. Human Triage &amp; Patch Retest</strong>
                      {activeSubmission.triage ? (
                        <p>Final decision: <strong>{activeSubmission.triage.decision}</strong> — {activeSubmission.triage.rationale}</p>
                      ) : (
                        <p>Awaiting explicit human team decision.</p>
                      )}

                      {activeSubmission.patchRetestJobs.map(job => (
                        <p key={job.id} className="mono-data">
                          Patch retest ({job.fixture}) → {job.verdict ?? job.state}
                          {job.receiptHash ? ` · receipt ${job.receiptHash.slice(0, 16)}…` : ""}
                        </p>
                      ))}

                      {data.actor.role === "team" && (
                        <div className="inbox-triage-actions">
                          <input
                            aria-label="Triage rationale"
                            value={triageRationale}
                            onChange={e => setTriageRationale(e.target.value)}
                            placeholder="Human triage rationale (optional)"
                          />
                          <div className="inbox-btn-row">
                            <button type="button" className="site-action site-action-dark focus-ring" disabled={Boolean(busyAction)} onClick={() => void submitTriage("accept")}>Accept</button>
                            <button type="button" className="report-secondary focus-ring" disabled={Boolean(busyAction)} onClick={() => void submitTriage("needs_info")}>Needs info</button>
                            <button type="button" className="report-secondary focus-ring" disabled={Boolean(busyAction)} onClick={() => void submitTriage("reject")}>Reject</button>
                            <button type="button" className="report-secondary focus-ring" disabled={Boolean(busyAction)} onClick={() => void triggerPatchRetest()}>Run PatchedVault retest</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                </ol>
              </article>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
