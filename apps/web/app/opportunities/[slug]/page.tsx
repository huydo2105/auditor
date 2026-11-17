import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import bounties from "@/public/data/bug-bounties.json";
import { NetworkBadge } from "@/components/opportunities/network-badge";
import { ExternalBountyTabs } from "@/components/opportunities/external-bounty-tabs";

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
    <header className="opportunity-detail-header"><div className="opportunity-identity"><span className="opportunity-identity-mark" aria-hidden="true"><Image src={bounty.logo} width={56} height={56} alt="" className="opportunity-project-logo" /></span><div><h1>{bounty.title}</h1><div className="opportunity-tags">{bounty.ecosystems.map(network => <NetworkBadge key={network} ecosystem={network} />)}<span>PoC required</span></div></div></div><p>{bounty.description}</p></header>
    <div className="opportunity-detail-layout"><div className="opportunity-detail-main"><ExternalBountyTabs bounty={bounty} /></div>
      <aside className="opportunity-detail-aside" aria-label="Bounty summary"><h2>Program details</h2><dl><div><dt>Maximum bounty</dt><dd>{bounty.maximumReward}</dd></div><div><dt>Submission host</dt><dd>Immunefi</dd></div><div><dt>Summary checked</dt><dd>{bounty.checkedAt}</dd></div></dl><Link className="site-action site-action-dark focus-ring" href={`/submit-report?bounty=${bounty.id}`}>Join bounty <ArrowRight size={16} aria-hidden="true" /></Link></aside></div>
  </main>;
}
