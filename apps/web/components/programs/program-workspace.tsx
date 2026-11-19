"use client";

import { ReportWizard } from "@/components/journeys/report-wizard";
import { ProgramConsole, type ProgramConsoleProps } from "@/components/programs/program-console";

/** Authorized Demo Vault program entry; renders the shared 4-step audit wizard unless embedded directly. */
export function ProgramWorkspace({
  embedded = false,
  onSubmissionChange,
  onJobChange,
}: { embedded?: boolean } & ProgramConsoleProps) {
  if (embedded) {
    return <ProgramConsole onSubmissionChange={onSubmissionChange} onJobChange={onJobChange} />;
  }
  return <ReportWizard unlockAllSteps />;
}
