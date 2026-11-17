import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import bounties from "@/public/data/bug-bounties.json";
import { NetworkBadge } from "@/components/opportunities/network-badge";

export function generateStaticParams() { return bounties.map(item => ({ slug: item.id })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const bounty = bounties.find(item => item.id === slug);
  return { title: bounty ? `${bounty.title} bug bounty overview` : "Opportunity" };
}

export default async function BountyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bounty = bounties.find(item => item.id === slug);
  if (!bounty) notFound();
  return <main id="main" className="site-shell opportunity-detail external-bounty-detail">
    <Link href="/get-started" className="back-link focus-ring"><ArrowLeft size={16} aria-hidden="true" /> All opportunities</Link>
    <header className="opportunity-detail-header"><div className="opportunity-identity"><span className="opportunity-identity-mark" aria-hidden="true">{bounty.title.slice(0, 1)}</span><div><p className="eyebrow">External bug bounty · Immunefi</p><h1>{bounty.title}</h1><div className="opportunity-tags">{bounty.ecosystems.map(network => <NetworkBadge key={network} ecosystem={network} />)}<span>PoC required</span></div></div></div><p>{bounty.description}</p></header>
    <div className="opportunity-detail-layout"><div className="opportunity-detail-main">
      <nav className="opportunity-detail-nav" aria-label="Bounty sections"><a href="#instructions">Instructions</a><a href="#scope">Scope</a><a href="#prior-audits">Prior audits</a></nav>
      <section id="instructions" className="opportunity-copy"><h2>Instructions</h2><p>Use the current official program rules as the source of truth. These short notes are a directory summary, not the full program policy.</p><ul>{bounty.instructions.map(item => <li key={item}>{item}</li>)}</ul><a href={bounty.programUrl} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">Read official instructions <ArrowUpRight size={16} aria-hidden="true" /></a></section>
      <section id="scope" className="opportunity-copy"><h2>Scope</h2><ul>{bounty.scope.map(item => <li key={item}>{item}</li>)}</ul><a href={bounty.scopeUrl} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">Inspect current assets and impacts <ArrowUpRight size={16} aria-hidden="true" /></a></section>
      <section id="prior-audits" className="opportunity-copy"><h2>Prior audits and resources</h2><p>Review public reports and known issues before preparing a new claim. Their contents do not expand the bounty scope.</p>{bounty.auditsUrl && <a href={bounty.auditsUrl} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">Open published audits or known issues <ArrowUpRight size={16} aria-hidden="true" /></a>}<a href={bounty.resourcesUrl} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">Open program resources <ArrowUpRight size={16} aria-hidden="true" /></a></section>
    </div><aside className="opportunity-detail-aside" aria-label="Bounty summary"><p className="eyebrow">Published on Immunefi</p><h2>Program details</h2><dl><div><dt>Maximum bounty</dt><dd>{bounty.maximumReward}</dd></div><div><dt>Submission</dt><dd>Immunefi</dd></div><div><dt>Summary checked</dt><dd>{bounty.checkedAt}</dd></div><div><dt>VeriPoC execution</dt><dd>Unavailable</dd></div></dl><p>Check current rules and eligibility before testing. Submit confidential reports through the official program. This external bounty is not connected to VeriPoC&apos;s local verifier.</p><a className="site-action site-action-dark focus-ring" href={bounty.programUrl} target="_blank" rel="noopener noreferrer">Open official bounty <ArrowUpRight size={16} aria-hidden="true" /></a></aside></div>
  </main>;
}
