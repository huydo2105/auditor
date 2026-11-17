"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpRight, Copy } from "lucide-react";
import bounties from "@/public/data/bug-bounties.json";

type Bounty = (typeof bounties)[number];
type Tab = "instructions" | "scope" | "audits" | "agent";
const tabs: { id: Tab; label: string }[] = [
  { id: "instructions", label: "Instructions" },
  { id: "scope", label: "Scope" },
  { id: "audits", label: "Prior audits" },
  { id: "agent", label: "Use your agent" },
];

function OfficialLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">{children} <ArrowUpRight size={16} aria-hidden="true" /></a>;
}

function agentBrief(bounty: Bounty) {
  return `Research brief: ${bounty.title} bug bounty\n\nOfficial program rules: ${bounty.programUrl}\nCurrent scope and eligible impacts: ${bounty.scopeUrl}\nCode and resources: ${bounty.resourcesUrl}${bounty.auditsUrl ? `\nPrevious audits / known issues: ${bounty.auditsUrl}` : ""}\n\n1. Read the current official rules, exclusions, assets and disclosure terms before starting. This VeriPoC directory is a dated summary, not the program authority.\n2. Investigate only assets explicitly allowed by the official program. Use public source, local static analysis and isolated local tests where its rules allow. Do not test deployed contracts or public testnets unless the current rules explicitly permit it.\n3. Review previous audits and known issues. Treat every AI-generated issue as an unverified hypothesis.\n4. For a candidate finding, prepare affected asset/version, invariant, impact, reproduction steps, and a PoC meeting the official program's requirements. Keep unpublished details private.\n5. Give the researcher a reviewable draft. The researcher submits through the official Immunefi program; VeriPoC cannot run this external PoC or submit it for them.`;
}

export function ExternalBountyTabs({ bounty }: { bounty: Bounty }) {
  const [active, setActive] = useState<Tab>("instructions");
  const [copyStatus, setCopyStatus] = useState("");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function selectByKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActive(tabs[next].id);
    buttons.current[next]?.focus();
  }

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(agentBrief(bounty));
      setCopyStatus("Research brief copied. Review the current program rules before using it with your agent.");
    } catch {
      setCopyStatus("Clipboard unavailable. Select and copy the brief below.");
    }
  }

  return <>
    <div className="opportunity-detail-nav external-bounty-tabs" role="tablist" aria-label="Bounty information">
      {tabs.map((tab, index) => <button key={tab.id} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`bounty-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls="bounty-panel" tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)} onKeyDown={event => selectByKeyboard(event, index)}>{tab.label}</button>)}
    </div>
    <section id="bounty-panel" role="tabpanel" aria-labelledby={`bounty-tab-${active}`} tabIndex={0} className="opportunity-copy external-bounty-panel">
      {active === "instructions" && <><h2>Instructions</h2><p>Read the official program terms before investigating. These notes summarize the public rules checked on {bounty.checkedAt}.</p><ul>{bounty.instructions.map(item => <li key={item}>{item}</li>)}</ul><OfficialLink href={bounty.programUrl}>Read official instructions</OfficialLink></>}
      {active === "scope" && <><h2>Scope</h2><ul>{bounty.scope.map(item => <li key={item}>{item}</li>)}</ul><p>The current official asset and impact list controls what you may test and report.</p><OfficialLink href={bounty.scopeUrl}>Inspect current scope</OfficialLink></>}
      {active === "audits" && <><h2>Prior audits and resources</h2><p>Review public reports and known issues before preparing a new claim. They do not expand the bounty scope.</p>{bounty.auditsUrl && <OfficialLink href={bounty.auditsUrl}>Published audits or known issues</OfficialLink>}<OfficialLink href={bounty.resourcesUrl}>Program resources and code</OfficialLink></>}
      {active === "agent" && <><h2>Investigate with your own AI agent</h2><p>Bring a researcher-controlled agent or use manual tools. This brief supplies public links and a safe review sequence; it does not launch an audit or give the agent program credentials.</p><ol><li>Read the official rules, scope, and exclusions.</li><li>Inspect public code and prior audits using permitted local tools.</li><li>Prepare a private, human-reviewed claim and reproducible PoC.</li><li>Submit through the official program if its current rules allow your finding.</li></ol><button type="button" className="site-action site-action-dark focus-ring" onClick={copyBrief}><Copy size={16} aria-hidden="true" /> Copy agent brief</button><p role="status" className="agent-brief-status">{copyStatus}</p><details className="agent-brief-details"><summary>View the full brief</summary><pre>{agentBrief(bounty)}</pre></details></>}
    </section>
  </>;
}
