"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EvidencePanel } from "@/components/verification/evidence-panel";
import {
  FixtureSelectorSection,
  fixtures,
  LiveVerificationSection,
  requestVerificationApi,
  RunComparisonAside,
} from "@/components/verification/verification-panels";
import type { Fixture, Job, JobState } from "@/lib/types";
import { parseAcceptance, parseJob } from "@/state.mjs";

export type Program = {
  id: string;
  name: string;
  target: string;
  targetSha256: string;
  oracle: string;
  allowedFixtures: string[];
  rules: string[];
  runLimit: number;
  runsUsed: number;
  authorization: string;
};

export type ProgramSubmission = {
  id: string;
  programId?: string;
  claim: string;
  authorId: string;
  targetSha256?: string;
  jobIds: string[];
};

type Actor = { id: string; role: string };

export type ProgramConsoleProps = {
  onSubmissionChange?: (submission: ProgramSubmission | null) => void;
  onJobChange?: (job: Job | null) => void;
};

const PROGRAM_BASE = "/v1/programs/demo-vault";

/** Embedded program-scoped Demo Vault console used inside Step 4 of the Demo Vault wizard. */
export function ProgramConsole({ onSubmissionChange, onJobChange }: ProgramConsoleProps) {
  const [fixture, setFixture] = useState<Fixture>("vulnerable");
  const [token, setToken] = useState("");
  const [actor, setActor] = useState<Actor | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [submissions, setSubmissions] = useState<ProgramSubmission[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [lastByFixture, setLastByFixture] = useState<Partial<Record<Fixture, string>>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [statusNote, setStatusNote] = useState("");
  const [canRetryStatus, setCanRetryStatus] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy private evidence JSON");

  const tokenInput = useRef<HTMLInputElement>(null);
  const pendingSubmissionKey = useRef<string | null>(null);
  const pendingJobKeys = useRef<Partial<Record<Fixture, string>>>({});
  const timers = useRef<Set<number>>(new Set());
  const currentIdRef = useRef<string | null>(null);
  const mounted = useRef(false);

  const current = currentId ? jobs[currentId] ?? null : null;
  const currentFixture = current?.fixture ?? null;

  useEffect(() => {
    mounted.current = true;
    const activeTimers = timers.current;
    return () => {
      mounted.current = false;
      for (const timer of activeTimers) window.clearTimeout(timer);
      activeTimers.clear();
    };
  }, []);

  function clearTimers() {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
  }

  function resetLoadedState() {
    clearTimers();
    pendingSubmissionKey.current = null;
    pendingJobKeys.current = {};
    currentIdRef.current = null;
    setActor(null);
    setProgram(null);
    setSubmissions([]);
    setJobs({});
    setLastByFixture({});
    setCurrentId(null);
    setMessage("");
    setStatusNote("");
    setCanRetryStatus(false);
    onSubmissionChange?.(null);
    onJobChange?.(null);
  }

  function recordJob(job: Job, selectJob: boolean) {
    setJobs(previous => ({ ...previous, [job.id]: job }));
    setLastByFixture(previous => ({ ...previous, [job.fixture]: job.id }));
    if (selectJob) {
      currentIdRef.current = job.id;
      setCurrentId(job.id);
      setCopyLabel("Copy private evidence JSON");
      onJobChange?.(job);
    }
  }

  async function refreshScope(apiToken: string) {
    const scope = (await requestVerificationApi(PROGRAM_BASE, apiToken)) as { program: Program; actor: Actor };
    const listing = (await requestVerificationApi(`${PROGRAM_BASE}/submissions`, apiToken)) as {
      submissions: ProgramSubmission[];
    };
    if (!mounted.current) return { scope, listing };
    setProgram(scope.program);
    setActor(scope.actor);
    setSubmissions(listing.submissions);
    const latest = listing.submissions.length ? listing.submissions[listing.submissions.length - 1] : null;
    onSubmissionChange?.(latest);
    return { scope, listing };
  }

  async function inspect(id: string, apiToken = token, selectJob = true) {
    try {
      const data = (await requestVerificationApi(`${PROGRAM_BASE}/jobs/${id}`, apiToken)) as {
        fixture?: Fixture;
        state?: JobState;
      };
      const expectedFixture = data.fixture && fixtures.includes(data.fixture) ? data.fixture : fixture;
      const parsed = parseJob(data, id, expectedFixture) as Job;
      if (!mounted.current) return null;
      recordJob(parsed, selectJob);
      if (currentIdRef.current === id) {
        setMessage("");
        setCanRetryStatus(false);
      }
      return parsed;
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Job unavailable");
      return null;
    }
  }

  async function poll(id: string, expectedFixture: Fixture, apiToken: string) {
    try {
      const data = await requestVerificationApi(`${PROGRAM_BASE}/jobs/${id}`, apiToken);
      const parsed = parseJob(data, id, expectedFixture) as Job;
      if (!mounted.current) return;
      recordJob(parsed, currentIdRef.current === id);
      if (currentIdRef.current === id) {
        setMessage("");
        setCanRetryStatus(false);
      }
      if (parsed.state !== "finished") {
        const timer = window.setTimeout(() => {
          timers.current.delete(timer);
          void poll(id, expectedFixture, apiToken);
        }, 750);
        timers.current.add(timer);
      } else {
        void refreshScope(apiToken).catch(() => {});
      }
    } catch (cause) {
      if (mounted.current && currentIdRef.current === id) {
        setMessage(`${cause instanceof Error ? cause.message : "Status lookup failed."} The job may still be running. Retry status lookup.`);
        setCanRetryStatus(true);
      }
    }
  }

  async function openProgram() {
    if (busy) return;
    if (!token.trim()) {
      setMessage("Enter a local program token before opening the authorized program.");
      tokenInput.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    setStatusNote("");
    setCanRetryStatus(false);
    clearTimers();
    try {
      const { scope, listing } = await refreshScope(token);
      if (!mounted.current) return;
      const allJobIds = listing.submissions.flatMap(item => item.jobIds);
      let newestJob: Job | null = null;
      for (const id of allJobIds) {
        const loaded = await inspect(id, token, true);
        if (loaded) newestJob = loaded;
      }
      if (!newestJob) {
        currentIdRef.current = null;
        setCurrentId(null);
        onJobChange?.(null);
      }
      setStatusNote(
        scope.actor.role === "team"
          ? "Opened protected program view as team owner. You can inspect submitted claims and private evidence."
          : "Opened Demo Vault program as invited researcher."
      );
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Program unavailable");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function submitClaim(apiToken: string, scopeProgram: Program) {
    const key = pendingSubmissionKey.current ?? crypto.randomUUID();
    pendingSubmissionKey.current = key;
    const item = (await requestVerificationApi(`${PROGRAM_BASE}/submissions`, apiToken, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ claim: "donation-share-inflation", targetSha256: scopeProgram.targetSha256 }),
    })) as ProgramSubmission;
    pendingSubmissionKey.current = null;
    if (mounted.current) {
      setSubmissions(previous => (previous.some(entry => entry.id === item.id) ? previous : [...previous, item]));
      onSubmissionChange?.(item);
      setStatusNote("Reviewed vault claim submitted privately to this program.");
    }
    return item;
  }

  async function runFixtureJob(submissionId: string, selectedFixture: Fixture, apiToken: string) {
    const key = pendingJobKeys.current[selectedFixture] ?? crypto.randomUUID();
    pendingJobKeys.current[selectedFixture] = key;
    const accepted = parseAcceptance(
      await requestVerificationApi(`${PROGRAM_BASE}/submissions/${submissionId}/jobs`, apiToken, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ artifactFormat: "repo-fixture-v1", fixture: selectedFixture }),
      })
    ) as { id: string; state: JobState };
    delete pendingJobKeys.current[selectedFixture];

    const job: Job =
      accepted.state === "finished"
        ? (parseJob(
            await requestVerificationApi(`${PROGRAM_BASE}/jobs/${accepted.id}`, apiToken),
            accepted.id,
            selectedFixture
          ) as Job)
        : { id: accepted.id, kind: "verify", fixture: selectedFixture, state: accepted.state, result: null };

    if (!mounted.current) return;
    setSubmissions(previous =>
      previous.map(item =>
        item.id === submissionId && !item.jobIds.includes(accepted.id)
          ? { ...item, jobIds: [...item.jobIds, accepted.id] }
          : item
      )
    );
    recordJob(job, true);
    void refreshScope(apiToken).catch(() => {});
    document.getElementById("verification")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    if (job.state !== "finished") void poll(accepted.id, selectedFixture, apiToken);
  }

  async function submitAndVerify() {
    if (busy) return;
    if (!token.trim()) {
      setMessage("Enter the local API token before verifying a PoC.");
      tokenInput.current?.focus();
      return;
    }
    setBusy(true);
    setMessage("");
    setStatusNote("");
    setCanRetryStatus(false);
    try {
      const { scope, listing } = await refreshScope(token);
      let targetSubmission =
        scope.actor.role === "researcher"
          ? listing.submissions.find(item => item.authorId === scope.actor.id) ?? null
          : null;
      if (!targetSubmission) {
        targetSubmission = await submitClaim(token, scope.program);
      }
      await runFixtureJob(targetSubmission.id, fixture, token);
    } catch (error) {
      if (mounted.current) {
        setMessage(`${error instanceof Error ? error.message : "Submission failed."} Press Submit & Verify PoC to retry.`);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function manualSubmitClaim() {
    if (!program || busy) return;
    setBusy(true);
    setMessage("");
    setStatusNote("");
    try {
      await submitClaim(token, program);
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Submission failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function manualRunFixture(submissionId: string, selectedFixture: Fixture) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setCanRetryStatus(false);
    try {
      await runFixtureJob(submissionId, selectedFixture, token);
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : "Run failed");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function copyEvidence() {
    if (current?.state !== "finished") return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(current, null, 2));
      setCopyLabel("Copied — share only with authorized reviewers");
    } catch {
      setCopyLabel("Clipboard failed — copy JSON manually");
    }
  }

  return (
    <section className="embedded-console pb-16" aria-label="Authorized Demo Vault program verification">
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_250px]">
        <div className="min-w-0 space-y-12">
          <FixtureSelectorSection
            fixture={fixture}
            onSelect={setFixture}
            title="Choose a fixture & authenticate"
            footerNote="Local EVM fixtures only. The API enforces program role, four-run quota, and fixture pins before launching the isolated worker."
          >
            <div className="space-y-4 border-t border-line pt-5">
              <div>
                <label htmlFor="program-token" className="mb-2 block text-xs font-semibold text-forest">
                  LOCAL PROGRAM TOKEN
                </label>
                <input
                  id="program-token"
                  ref={tokenInput}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={token}
                  onChange={event => {
                    setToken(event.target.value);
                    resetLoadedState();
                  }}
                  className="focus-ring w-full rounded-lg border border-line bg-surface px-3 py-3 text-sm"
                  placeholder="Paste your invited researcher or team token"
                  aria-describedby="program-token-help"
                />
                <p id="program-token-help" className="mt-2 text-xs text-muted">
                  Held in page memory; never placed in URLs or browser storage. The API determines your role from this token.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void openProgram()}
                  disabled={!token.trim() || busy}
                >
                  Open authorized program
                </Button>
                <Button type="button" onClick={() => void submitAndVerify()} disabled={busy}>
                  {busy ? "Submitting…" : "Submit & Verify PoC"}
                  <ArrowRight size={16} aria-hidden="true" />
                </Button>
              </div>
              {statusNote && (
                <p data-testid="program-status" aria-live="polite" className="text-sm font-medium text-forest">
                  {statusNote}
                </p>
              )}
              {!program && message && (
                <div data-testid="program-error" aria-live="polite" className="verification-error rounded-lg p-3 text-sm">
                  {message}
                </div>
              )}
            </div>
          </FixtureSelectorSection>

          {program && actor && (
            <section aria-label="Protected program view">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">Protected program view</h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-forest">
                  <Shield size={14} aria-hidden="true" />
                  Role: {actor.role}
                </span>
              </div>
              <Card className="p-5 md:p-7">
                <h3 className="text-xl font-semibold">{program.name}</h3>
                <p className="mt-2 text-sm text-muted">
                  Signed in locally as <strong>{actor.role}</strong> (<code>{actor.id}</code>). This in-memory role is configured on the API server.
                </p>
                <dl className="opportunity-scope mt-4 text-sm">
                  <div><dt>Target</dt><dd>{program.target}</dd></div>
                  <div><dt>Target SHA-256</dt><dd className="mono-data">{program.targetSha256}</dd></div>
                  <div><dt>Trusted oracle</dt><dd>{program.oracle}</dd></div>
                  <div><dt>Runs used</dt><dd>{program.runsUsed} / {program.runLimit}</dd></div>
                </dl>
                <div className="mt-5 border-t border-line pt-5">
                  <h4 className="text-sm font-semibold">Rules and authorization</h4>
                  <p className="mt-1 text-sm text-muted">{program.authorization}</p>
                  <ul className="mt-2 list-disc pl-5 text-sm text-muted">
                    {program.rules.map(rule => (
                      <li key={rule}>{rule}</li>
                    ))}
                  </ul>
                </div>
                <div className="mt-6 border-t border-line pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-lg font-semibold">Private submissions</h4>
                    {actor.role === "researcher" && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void manualSubmitClaim()}
                      >
                        Submit reviewed vault claim
                      </Button>
                    )}
                  </div>
                  {submissions.length === 0 ? (
                    <p className="mt-3 text-sm text-muted">No submissions in this server session.</p>
                  ) : (
                    <div className="mt-4 space-y-4">
                      {submissions.map(item => (
                        <article key={item.id} className="rounded-lg border border-line bg-page p-4">
                          <h5 className="text-base font-semibold">{item.claim}</h5>
                          <p className="mono-data mt-1 text-xs text-muted">
                            {item.id} · {item.authorId}
                          </p>
                          {actor.role === "researcher" && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {program.allowedFixtures.map(allowed => (
                                <Button
                                  key={allowed}
                                  type="button"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void manualRunFixture(item.id, allowed as Fixture)}
                                >
                                  Run {allowed} fixture
                                </Button>
                              ))}
                            </div>
                          )}
                          {item.jobIds.length > 0 && (
                            <ul className="mt-3 space-y-2 border-t border-line pt-3">
                              {item.jobIds.map(id => (
                                <li key={id}>
                                  <button
                                    type="button"
                                    className="focus-ring text-left text-sm font-medium text-forest underline underline-offset-4"
                                    onClick={() => void inspect(id)}
                                  >
                                    View private job {id}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </section>
          )}

          <LiveVerificationSection
            current={current}
            message={message}
            canRetryStatus={canRetryStatus}
            onRetry={() => {
              if (!current) return;
              setMessage("");
              void poll(current.id, current.fixture, token);
            }}
          />

          <EvidencePanel job={current} fixture={currentFixture} copied={copyLabel} onCopy={() => void copyEvidence()} />
        </div>

        <RunComparisonAside jobs={jobs} lastByFixture={lastByFixture} />
      </div>
    </section>
  );
}
