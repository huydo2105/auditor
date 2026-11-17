"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import bounties from "@/public/data/bug-bounties.json";

type Bounty = (typeof bounties)[number];
type Tab = "instructions" | "scope" | "audits";
const tabs: { id: Tab; label: string }[] = [
  { id: "instructions", label: "Instructions" },
  { id: "scope", label: "Scope" },
  { id: "audits", label: "Prior audits" },
];

function OfficialLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">{children} <ArrowUpRight size={16} aria-hidden="true" /></a>;
}

export function ExternalBountyTabs({ bounty }: { bounty: Bounty }) {
  const [active, setActive] = useState<Tab>("instructions");
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);

  function selectByKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setActive(tabs[next].id);
    buttons.current[next]?.focus();
  }

  return <>
    <div className="opportunity-detail-nav external-bounty-tabs" role="tablist" aria-label="Bounty information">
      {tabs.map((tab, index) => <button key={tab.id} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`bounty-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls="bounty-panel" tabIndex={active === tab.id ? 0 : -1} onClick={() => setActive(tab.id)} onKeyDown={event => selectByKeyboard(event, index)}>{tab.label}</button>)}
    </div>
    <section id="bounty-panel" role="tabpanel" aria-labelledby={`bounty-tab-${active}`} tabIndex={0} className="opportunity-copy external-bounty-panel">
      {active === "instructions" && <><h2>Instructions</h2><p>Read the official program terms before investigating. These notes summarize the public rules checked on {bounty.checkedAt}.</p><ul>{bounty.instructions.map(item => <li key={item}>{item}</li>)}</ul><OfficialLink href={bounty.programUrl}>Read official instructions</OfficialLink></>}
      {active === "scope" && <><h2>Scope</h2><ul>{bounty.scope.map(item => <li key={item}>{item}</li>)}</ul><p>The current official asset and impact list controls what you may test and report.</p><OfficialLink href={bounty.scopeUrl}>Inspect current scope</OfficialLink></>}
      {active === "audits" && <><h2>Prior audits and resources</h2><p>Review public reports and known issues before preparing a new claim. They do not expand the bounty scope.</p>{bounty.auditsUrl && <OfficialLink href={bounty.auditsUrl}>Published audits or known issues</OfficialLink>}<OfficialLink href={bounty.resourcesUrl}>Program resources and code</OfficialLink></>}
    </section>
  </>;
}
