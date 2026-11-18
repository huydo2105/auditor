"use client";

import { useState } from "react";
import Link from "next/link";

type Program = { id: string; name: string; target: string; targetSha256: string; oracle: string;
  allowedFixtures: string[]; rules: string[]; runLimit: number; runsUsed: number; authorization: string };
type Submission = { id: string; claim: string; authorId: string; jobIds: string[] };
type Job = { id: string; fixture: string; state: string; result: { status: string; reason?: string;
  financialEvidence?: unknown; receipt?: unknown; anchor?: { receiptSha256?: string } } | null };

export function ProgramWorkspace() {
  const [token, setToken] = useState("");
  const [actor, setActor] = useState<{ id: string; role: string } | null>(null);
  const [program, setProgram] = useState<Program | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const base = "/v1/programs/demo-vault";

  async function request(path: string, method = "GET", body?: unknown, key?: string) {
    const response = await fetch(base + path, { method, cache: "no-store", credentials: "omit",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json", "Idempotency-Key": key ?? crypto.randomUUID() } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
    return data;
  }

  async function load() {
    setBusy(true); setMessage(""); setProgram(null); setActor(null); setSubmissions([]); setJob(null);
    try {
      const scope = await request("");
      const listing = await request("/submissions");
      setProgram(scope.program); setActor(scope.actor); setSubmissions(listing.submissions);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Program unavailable"); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (!program) return;
    setBusy(true); setMessage("");
    try {
      const item = await request("/submissions", "POST", { claim: "donation-share-inflation", targetSha256: program.targetSha256 });
      setSubmissions(previous => [...previous, item]);
      setMessage("Reviewed vault claim submitted privately to this program.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Submission failed"); }
    finally { setBusy(false); }
  }

  async function run(submissionId: string, fixture: string) {
    setBusy(true); setMessage("");
    try {
      const accepted = await request(`/submissions/${submissionId}/jobs`, "POST", { artifactFormat: "repo-fixture-v1", fixture });
      setSubmissions(previous => previous.map(item => item.id === submissionId ? { ...item, jobIds: [...item.jobIds, accepted.id] } : item));
      await inspect(accepted.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run failed"); }
    finally { setBusy(false); }
  }

  async function inspect(id: string) {
    try { setJob(await request(`/jobs/${id}`)); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Job unavailable"); }
  }

  return <main id="main" className="site-shell opportunity-detail">
    <Link href="/opportunities/demo-vault" className="back-link focus-ring">← Public fixture details</Link>
    <header className="opportunity-detail-header"><div><p className="eyebrow">Local authorized demo</p><h1>Demo Vault Audit Program</h1><p>Enter your server configured team or invited researcher token. The API decides your role and keeps the evidence private to program members.</p></div></header>
    <section className="opportunity-copy" aria-label="Program access">
      <label htmlFor="program-token">Local program token</label>
      <input id="program-token" className="focus-ring" type="password" autoComplete="off" value={token} onChange={event => { setToken(event.target.value); setProgram(null); setActor(null); setSubmissions([]); setJob(null); }} />
      <button className="site-action site-action-dark focus-ring" type="button" disabled={!token || busy} onClick={() => void load()}>Open authorized program</button>
      {message && <p role="status">{message}</p>}
    </section>
    {program && actor && <div className="opportunity-detail-layout"><section className="opportunity-detail-main opportunity-copy">
      <h2>{program.name}</h2><p>Signed in locally as {actor.role} ({actor.id}). This in-memory role is configured on the API server.</p>
      <dl className="opportunity-scope"><div><dt>Target</dt><dd>{program.target}</dd></div><div><dt>Target SHA-256</dt><dd className="mono-data">{program.targetSha256}</dd></div><div><dt>Trusted oracle</dt><dd>{program.oracle}</dd></div><div><dt>Runs used</dt><dd>{program.runsUsed} / {program.runLimit}</dd></div></dl>
      <h3>Rules and authorization</h3><p>{program.authorization}</p><ul>{program.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
      <h3>Private submissions</h3>
      {actor.role === "researcher" && <button className="site-action site-action-dark focus-ring" type="button" disabled={busy} onClick={() => void submit()}>Submit reviewed vault claim</button>}
      {submissions.length === 0 && <p>No submissions in this server session.</p>}
      {submissions.map(item => <article key={item.id}><h4>{item.claim}</h4><p className="mono-data">{item.id} · {item.authorId}</p>
        {actor.role === "researcher" && program.allowedFixtures.map(fixture => <button key={fixture} className="site-action focus-ring" type="button" disabled={busy} onClick={() => void run(item.id, fixture)}>Run {fixture} fixture</button>)}
        <ul>{item.jobIds.map(id => <li key={id}><button type="button" className="focus-ring" onClick={() => void inspect(id)}>View private job {id}</button></li>)}</ul>
      </article>)}
      {job && <section aria-label="Private verification evidence"><h3>Job {job.id}</h3><p>{job.fixture} · {job.state} · {job.result?.status ?? "Awaiting worker"}</p>
        {job.state !== "finished" && <button type="button" className="site-action focus-ring" onClick={() => void inspect(job.id)}>Refresh job</button>}
        {job.result && <><p>Receipt digest: <code>{job.result.anchor?.receiptSha256 ?? "Unavailable"}</code>. Local digest only; no Testnet anchor.</p><pre className="overflow-auto"><code>{JSON.stringify(job.result, null, 2)}</code></pre></>}
      </section>}
    </section></div>}
  </main>;
}
