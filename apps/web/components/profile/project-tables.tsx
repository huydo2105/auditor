"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { ensureWalletSession } from "@/lib/wallet-session";

type Project = {
  id: string;
  name: string;
  chain: string;
  visibility: "public" | "private";
  status: string;
  verification: string;
  sourceRevision: string;
};
type Tab = "owned" | "invited";

async function readProjects(path: string, allowForbidden = false): Promise<Project[]> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (allowForbidden && response.status === 403) return [];
  if (!response.ok) throw new Error("Projects could not be loaded. Try again.");
  const body = await response.json();
  if (!Array.isArray(body.programs)) throw new Error("Projects could not be loaded. Try again.");
  return body.programs;
}

export function ProjectTables() {
  const [tab, setTab] = useState<Tab>("owned");
  const [owned, setOwned] = useState<Project[]>([]);
  const [invited, setInvited] = useState<Project[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/v1/auth/me", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error("Projects could not be loaded. Try again.");
        const session = await response.json();
        if (!session.authenticated) {
          if (active) { setSignedOut(true); setOwned([]); setInvited([]); }
          return;
        }
        const [mine, invitations] = await Promise.all([
          readProjects("/v1/programs/mine", true), readProjects("/v1/programs/invited"),
        ]);
        if (active) { setOwned(mine); setInvited(invitations); setSignedOut(false); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Projects could not be loaded. Try again.");
      } finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  }, [refresh]);

  async function signIn() {
    setBusy(true);
    setError("");
    try {
      await ensureWalletSession();
      setRefresh(value => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet sign-in failed."); }
    finally { setBusy(false); }
  }

  function switchWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? "owned" : event.key === "End" ? "invited"
      : tab === "owned" ? "invited" : "owned";
    setTab(next);
    document.getElementById(`${next}-projects-tab`)?.focus();
  }

  const projects = tab === "owned" ? owned : invited;
  return <div className="projects-view">
    <h2>Projects</h2>
    <div className="projects-tabs" role="tablist" aria-label="Project access">
      {(["owned", "invited"] as const).map(value => <button key={value} type="button"
        id={`${value}-projects-tab`} role="tab" aria-selected={tab === value}
        aria-controls={`${value}-projects-panel`} tabIndex={tab === value ? 0 : -1}
        className="focus-ring" onKeyDown={switchWithKeyboard} onClick={() => setTab(value)}>
        {value === "owned" ? "Owned" : "Invited"}</button>)}
    </div>
    <section id={`${tab}-projects-panel`} role="tabpanel" aria-labelledby={`${tab}-projects-tab`}>
      <div className="projects-toolbar">
        <span>{loading ? "Loading projects…" : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}</span>
        {tab === "owned" && <Link href="/teams/new" className="site-action site-action-dark focus-ring"><Plus size={16} aria-hidden="true" /> Create Program</Link>}
      </div>
      <div className="projects-table-scroll"><table className="projects-table">
        <caption className="sr-only">{tab === "owned" ? "Owned projects" : "Invited projects"}</caption>
        <thead><tr><th scope="col">Project</th><th scope="col">Network</th><th scope="col">Visibility</th><th scope="col">Status</th><th scope="col">Verification</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
        <tbody>{projects.map(project => <tr key={project.id}>
          <td><Link href={`/programs/${project.id}`} className="projects-name focus-ring">{project.name}</Link><small>Revision {project.sourceRevision.slice(0, 12)}</small></td>
          <td>{project.chain}</td><td>{project.visibility}</td><td><span className="projects-status">{project.status}</span></td>
          <td>{project.verification}</td><td><Link href={`/programs/${project.id}`} className="projects-open focus-ring" aria-label={`Open ${project.name}`}>Open <ArrowRight size={15} aria-hidden="true" /></Link></td>
        </tr>)}</tbody>
      </table></div>
      {projects.length > 0 && <p className="projects-scroll-hint">Scroll right for status and verification details →</p>}
      {!loading && projects.length === 0 && <div className="projects-empty">
        {error && <p role="alert">{error}</p>}
        {signedOut ? <button type="button" className="site-action focus-ring" disabled={busy} onClick={signIn}>{busy ? "Signing in…" : "Sign with Concordium"}</button>
          : error ? <button type="button" className="site-action focus-ring" onClick={() => setRefresh(value => value + 1)}>Retry</button>
            : <p>{tab === "owned" ? "No owned projects yet." : "No invitations yet."}</p>}
      </div>}
      {error && projects.length > 0 && <p role="alert" className="projects-error">{error}</p>}
    </section>
  </div>;
}
