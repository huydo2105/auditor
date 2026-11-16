"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BookOpen, CheckCircle2, Code2, ExternalLink, Search } from "lucide-react";
import { DemoMetrics } from "@/components/landing/demo-metrics";
import publicSources from "@/public/data/public-sources.json";

type Category = "all" | "source" | "practice" | "bounties" | "competitions" | "ended";
type Source = (typeof publicSources)[number];

const categories: { id: Category; label: string; count: number }[] = [
  { id: "all", label: "All", count: publicSources.length + 1 },
  { id: "source", label: "Public source", count: publicSources.filter(item => item.kind === "protocol").length },
  { id: "practice", label: "Practice labs", count: publicSources.filter(item => item.kind === "practice").length },
  { id: "bounties", label: "Bounties", count: 0 },
  { id: "competitions", label: "Competitions", count: 0 },
  { id: "ended", label: "Ended", count: 0 },
];

function TeamPromo() {
  return <section className="directory-promo" aria-labelledby="promo-title"><p className="eyebrow">For DeFi teams</p><h2 id="promo-title">High-signal findings.<br />Evidence you can review.</h2><p>Preview how your project scope could look. Program publishing, invitations, and bounty payouts are not live yet.</p><Link href="/teams/new" className="site-action site-action-dark focus-ring">Preview an unsaved project <ArrowRight size={16} aria-hidden="true" /></Link></section>;
}

function SourceRow({ source }: { source: Source }) {
  const practice = source.kind === "practice";
  const url = `https://github.com/${source.repository}/tree/${source.revision}`;
  return <a href={url} target="_blank" rel="noopener noreferrer" className="directory-row directory-source focus-ring" aria-label={`Open official source for ${source.title} on GitHub (new tab)`}>
    <div className="directory-row-main"><span className="directory-mark directory-mark-muted" aria-hidden="true">{practice ? <BookOpen size={22} /> : <Code2 size={22} />}</span><div><strong>{source.title}</strong><small>{source.owner} · {source.description}</small></div><span className="directory-reward">View source<small>GitHub ↗</small></span></div>
    <div className="directory-row-foot"><span>{practice ? "Practice project" : "Protocol or library"}</span><span className="directory-badge directory-badge-muted">Read-only source</span><span className="directory-revision">Pinned revision <code>{source.revision.slice(0, 12)}</code></span><span className="directory-date">Official repository <ExternalLink size={14} aria-hidden="true" /></span></div>
  </a>;
}

export function OpportunityList() {
  const [category, setCategory] = useState<Category>("all");
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(needle);
  const showVault = category === "all" && matches("Demo Vault Audit Program ERC-4626 local fixture VeriPoC");
  const visibleSources = publicSources.filter(item =>
    (category === "all" || category === "source" && item.kind === "protocol" || category === "practice" && item.kind === "practice") &&
    matches(`${item.title} ${item.owner} ${item.description} ${item.repository}`));
  const count = Number(showVault) + visibleSources.length;

  return <main id="main" className="site-shell directory-page">
    <section className="directory-hero" aria-labelledby="directory-title"><h1 id="directory-title">Opportunities</h1><p>Explore public smart-contract source and practice projects. Only VeriPoC&apos;s reviewed local vault fixture supports a verification run today.</p></section>
    <div className="directory-content">
      <DemoMetrics />
      <div className="directory-tabs" role="group" aria-label="Opportunity category">
        {categories.map(item => <button key={item.id} type="button" className="focus-ring" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label} <span>{item.count}</span></button>)}
      </div>
      <label className="directory-search"><Search size={17} aria-hidden="true" /><span className="sr-only">Search opportunities</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search opportunities" /></label>
      <div className="directory-list" aria-live="polite">
        {showVault && <Link href="/opportunities/demo-vault" className="directory-row directory-live focus-ring" aria-label="Open Demo Vault Audit Program details">
          <div className="directory-row-main"><span className="directory-mark"><Image src="/brand/veripoc-mark.svg" width={30} height={30} alt="" aria-hidden="true" /></span><div><strong>Demo Vault Audit Program</strong><small>VeriPoC reviewed synthetic fixture</small></div><span className="directory-reward">No bounty<small>Local demo</small></span></div>
          <div className="directory-row-foot"><span>PoC verification</span><span className="directory-badge"><CheckCircle2 size={14} aria-hidden="true" /> Runnable demo</span><span>ERC-4626-style vault</span><span className="directory-date">Reviewed local fixture <ArrowRight size={16} aria-hidden="true" /></span></div>
        </Link>}
        {showVault && <TeamPromo />}
        {visibleSources.map(item => <SourceRow key={item.id} source={item} />)}
        {count === 0 && <div className="directory-empty" role="status"><h2>No matching entries</h2><p>{["bounties", "competitions", "ended"].includes(category) ? `There are no live ${category} in VeriPoC yet. The reviewed vault remains available under All.` : "Try another search or category. Only the reviewed vault is runnable here."}</p></div>}
      </div>
      <p className="directory-limit">Public repositories are source references, not VeriPoC audit programs. Their owners have not authorized VeriPoC submissions, verification, or bounties through this listing. Only the reviewed local vault is runnable; program permissions are planned for Issue #35.</p>
    </div>
  </main>;
}
