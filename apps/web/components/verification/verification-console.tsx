"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EvidencePanel } from "@/components/verification/evidence-panel";
import { fixtures, LiveVerificationSection, requestVerificationApi, RunComparisonAside } from "@/components/verification/verification-panels";
import type { Fixture, Job, JobState } from "@/lib/types";
import { FIXTURES, parseAcceptance, parseJob } from "@/state.mjs";

export function VerificationConsole({ embedded = false }: { embedded?: boolean }) {
  const [fixture, setFixture] = useState<Fixture>("vulnerable");
  const [token, setToken] = useState("");
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [lastByFixture, setLastByFixture] = useState<Partial<Record<Fixture, string>>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [canRetryStatus, setCanRetryStatus] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy private evidence JSON");
  const [identityState, setIdentityState] = useState("Checking the published Agent Card…");
  const tokenInput = useRef<HTMLInputElement>(null);
  const pendingKeys = useRef<Partial<Record<Fixture, string>>>({});
  const timers = useRef<Set<number>>(new Set());
  const currentIdRef = useRef<string | null>(null);
  const mounted = useRef(false);
  const current = currentId ? jobs[currentId] ?? null : null;
  const currentFixture = current?.fixture ?? null;

  useEffect(() => {
    let active = true;
    mounted.current = true;
    const activeTimers = timers.current;
    fetch("/.well-known/agent-card.json", { cache: "no-store", credentials: "omit" }).then(async response => {
      if (!response.ok) throw new Error("card unavailable");
      const card = await response.json();
      if (!card.registrations?.some((item: { agentId?: number }) => item.agentId === 1067)) throw new Error("card mismatch");
      if (active) setIdentityState("Agent #1067 is listed in the published card. Registry status and signed request identity are not established by this page.");
    }).catch(() => { if (active) setIdentityState("The published card could not be read. Registry status and request identity are unverified."); });
    return () => { active = false; mounted.current = false; for (const timer of activeTimers) window.clearTimeout(timer); activeTimers.clear(); };
  }, []);

  async function poll(id: string, selected: Fixture, apiToken: string) {
    try {
      const data = await requestVerificationApi(`/v1/jobs/${id}`, apiToken);
      const job = parseJob(data, id, selected) as Job;
      if (!mounted.current) return;
      setJobs(previous => ({ ...previous, [id]: job }));
      if (currentIdRef.current === id) { setMessage(""); setCanRetryStatus(false); }
      if (job.state !== "finished") {
        const timer = window.setTimeout(() => { timers.current.delete(timer); void poll(id, selected, apiToken); }, 2000);
        timers.current.add(timer);
      }
    } catch (cause) {
      if (mounted.current && currentIdRef.current === id) {
        setMessage(`${cause instanceof Error ? cause.message : "Status lookup failed."} The job may still be running. Retry status lookup.`);
        setCanRetryStatus(true);
      }
    }
  }

  async function submit() {
    if (submitting) return;
    if (!token) { setMessage("Enter the local API token before verifying a PoC."); tokenInput.current?.focus(); return; }
    setSubmitting(true); setMessage(""); setCanRetryStatus(false);
    const selected = fixture;
    const key = pendingKeys.current[selected] ?? crypto.randomUUID();
    pendingKeys.current[selected] = key;
    try {
      const accepted = parseAcceptance(await requestVerificationApi("/v1/verify-poc", token, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ artifactFormat: "repo-fixture-v1", fixture: selected }),
      })) as { id: string; state: JobState };
      const job: Job = accepted.state === "finished"
        ? parseJob(await requestVerificationApi(`/v1/jobs/${accepted.id}`, token), accepted.id, selected) as Job
        : { id: accepted.id, kind: "verify", fixture: selected, state: accepted.state, result: null };
      delete pendingKeys.current[selected];
      setJobs(previous => ({ ...previous, [accepted.id]: job }));
      setLastByFixture(previous => ({ ...previous, [selected]: accepted.id }));
      currentIdRef.current = accepted.id;
      setCurrentId(accepted.id);
      setCopyLabel("Copy private evidence JSON");
      document.getElementById("verification")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      if (job.state !== "finished") void poll(accepted.id, selected, token);
    } catch (cause) {
      setMessage(`${cause instanceof Error ? cause.message : "Submission failed."} Press Verify PoC to retry this fixture.`);
    } finally { setSubmitting(false); }
  }

  async function copyEvidence() {
    if (current?.state !== "finished") return;
    try { await navigator.clipboard.writeText(JSON.stringify(current, null, 2)); setCopyLabel("Copied — share only with authorized reviewers"); }
    catch { setCopyLabel("Clipboard failed — copy JSON manually"); }
  }

  const Container = embedded ? "section" : "main";
  const Heading = embedded ? "h2" : "h1";
  return <Container id={embedded ? undefined : "main"} className={embedded ? "embedded-console pb-16" : "site-shell pb-16"}>
    <section className="site-hero" aria-labelledby="verify-title">
      <Heading id="verify-title" className="site-title">Verify a <span>PoC.</span></Heading>
      <p className="mt-5 max-w-xl text-muted">Run a reviewed vault fixture in isolated Foundry and inspect the private receipt.</p>
    </section>

    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 space-y-12">
        <section id="submission" aria-labelledby="submission-title"><div className="mb-4"><h2 id="submission-title" className="text-2xl font-semibold">Choose a fixture</h2></div><Card className="p-5 md:p-7">
          <div className="mb-7 grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose reviewed fixture">{fixtures.map(key => <button type="button" key={key} onClick={() => setFixture(key)} aria-pressed={fixture === key} className={`focus-ring min-h-16 rounded-lg border p-4 text-left ${fixture === key ? "border-forest bg-forest-soft" : "border-line bg-surface hover:border-forest"}`}><strong className="block text-sm">{FIXTURES[key].name}</strong><span className="mt-1 block text-xs text-muted">{key === "vulnerable" ? "Expected exploit reproduction" : "Same PoC, protected implementation"}</span></button>)}</div>
          <p className="mb-1 text-xs font-semibold text-forest">CLAIM / LOCAL REVIEWED FIXTURE</p><h3 className="mb-2 text-xl font-semibold">{FIXTURES[fixture].title}</h3><p className="mb-6 text-sm leading-relaxed text-muted">{FIXTURES[fixture].description}</p>
          <details className="mb-5 rounded-lg border border-line p-4">
            <summary className="focus-ring rounded font-medium">Fixture and test details</summary>
            <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">Contract</dt><dd className="break-words">{FIXTURES[fixture].contract}</dd></div>
              <div><dt className="text-muted">Trusted test</dt><dd className="break-words">{FIXTURES[fixture].oracle}</dd></div>
              <div><dt className="text-muted">Expected outcome</dt><dd>{FIXTURES[fixture].expected}</dd></div>
              <div><dt className="text-muted">Invariant</dt><dd>{FIXTURES[fixture].invariant}</dd></div>
            </dl>
          </details>
          <div className="flex flex-col gap-4 border-t border-line pt-5 sm:flex-row sm:items-end"><div className="flex-1"><label htmlFor="api-token" className="mb-2 block text-xs font-semibold text-forest">LOCAL API TOKEN</label><input id="api-token" ref={tokenInput} type="password" autoComplete="off" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} className="focus-ring w-full rounded-lg border border-line bg-surface px-3 py-3 text-sm" placeholder="Paste your local API token" aria-describedby="token-help" /><p id="token-help" className="mt-2 text-xs text-muted">Held in page memory; forwarded only to the configured verification API.</p></div><Button type="button" onClick={() => void submit()} disabled={submitting} className="sm:min-w-40">{submitting ? "Submitting…" : "Verify PoC"}<ArrowRight size={16} aria-hidden="true" /></Button></div>
          <p className="mt-5 text-xs leading-relaxed text-muted">Local EVM fixtures only. The worker runs without network access.</p>
        </Card></section>

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

        <section id="identity" aria-labelledby="identity-title"><div className="mb-4"><h2 id="identity-title" className="text-2xl font-semibold">Concordium identity</h2></div><Card className="p-5 md:p-7"><h3 className="text-lg font-semibold">Published Agent Card · Agent #1067</h3><p className="mt-2 text-sm text-muted">{identityState}</p><div className="mt-4 flex flex-wrap gap-4 text-sm"><a className="focus-ring text-forest underline underline-offset-4" href="/.well-known/agent-card.json" target="_blank" rel="noopener noreferrer">View Agent Card</a><a className="focus-ring text-forest underline underline-offset-4" href="https://agent-registry-mcp.concordium.com/v1/check-badge/JyP9UhUtd9AeJywDRsg5q" target="_blank" rel="noopener noreferrer">Registry badge check</a></div><div className="mt-5 grid gap-3 border-t border-line pt-5 sm:grid-cols-2"><p className="text-sm text-muted"><strong className="block text-ink">Signed requests · Planned</strong>Signed request authentication is not established by the local bearer token.</p><p className="text-sm text-muted"><strong className="block text-ink">Testnet anchoring · Planned</strong>The current digest has no confirmed Testnet transaction.</p></div></Card></section>
      </div>

      <RunComparisonAside jobs={jobs} lastByFixture={lastByFixture} />
    </div>
  </Container>;
}
