import type { Metadata } from "next";
import { ReportWizard } from "@/components/journeys/report-wizard";

export const metadata: Metadata = { title: "Prepare a finding" };

export default function SubmitReportPage() {
  return <ReportWizard />;
}
