import type { Metadata } from "next";
import { ReportWizard } from "@/components/journeys/report-wizard";
import { ExternalReportDraft } from "@/components/journeys/external-report-draft";
import bounties from "@/public/data/bug-bounties.json";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Prepare a finding" };

export default async function SubmitReportPage({ searchParams }: { searchParams: Promise<{ bounty?: string | string[] }> }) {
  const { bounty: slug } = await searchParams;
  if (slug === undefined) return <ReportWizard />;
  const bounty = typeof slug === "string" ? bounties.find(item => item.id === slug) : undefined;
  if (!bounty) notFound();
  return <ExternalReportDraft bounty={bounty} />;
}
