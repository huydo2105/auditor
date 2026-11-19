"use client";

import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Fixture, Job, JobResult } from "@/lib/types";
import { FIXTURES, VERDICTS, apiError, financialEvidence, receiptDigest, stageStates } from "@/state.mjs";

export const fixtures: Fixture[] = ["vulnerable", "patched"];

const stages = [
  ["Input validation", "API accepts only reviewed fixture references"],
  ["Isolated Foundry execution", "Trusted oracle in a network-disabled worker"],
  ["Invariant checking", "Verdict derives from the trusted test result"],
  ["Evidence generation", "Private receipt and local public digest"],
] as const;

const stageLabel = {
  done: "Complete",
  active: "Running",
  failed: "Failed",
  unavailable: "Unavailable",
  pending: "Pending",
} as const;

/** Fetch a JSON endpoint with a Bearer token held only in memory. */
export async function requestVerificationApi(path: string, apiToken: string, options: RequestInit = {}) {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "omit",
      cache: "no-store",
      headers: { ...options.headers, Authorization: `Bearer ${apiToken}` },
    });
  } catch {
    throw new Error("The verification API is unavailable. Start it and retry.");
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error("The API returned an unreadable response.");
  }
  if (!response.ok) throw new Error(apiError(response.status, (data as { error?: string })?.error));
  return data;
}

/** Shared fixture selector and details panel used by both legacy /verify and program-scoped Demo Vault. */
export function FixtureSelectorSection({
  fixture,
  onSelect,
  title = "Choose a fixture",
  children,
  footerNote = "Local EVM fixtures only. The worker runs without network access.",
}: {
  fixture: Fixture;
  onSelect: (next: Fixture) => void;
  title?: string;
  children: ReactNode;
  footerNote?: string;
}) {
  return (
    <section id="submission" aria-labelledby="submission-title">
      <div className="mb-4">
        <h2 id="submission-title" className="text-2xl font-semibold">{title}</h2>
      </div>
      <Card className="p-5 md:p-7">
        <div className="mb-7 grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose reviewed fixture">
          {fixtures.map(key => (
            <button
              type="button"
              key={key}
              onClick={() => onSelect(key)}
              aria-pressed={fixture === key}
              className={`focus-ring min-h-16 rounded-lg border p-4 text-left ${
                fixture === key ? "border-forest bg-forest-soft" : "border-line bg-surface hover:border-forest"
              }`}
            >
              <strong className="block text-sm">{FIXTURES[key].name}</strong>
              <span className="mt-1 block text-xs text-muted">
                {key === "vulnerable" ? "Expected exploit reproduction" : "Same PoC, protected implementation"}
              </span>
            </button>
          ))}
        </div>
        <p className="mb-1 text-xs font-semibold text-forest">CLAIM / LOCAL REVIEWED FIXTURE</p>
        <h3 className="mb-2 text-xl font-semibold">{FIXTURES[fixture].title}</h3>
        <p className="mb-6 text-sm leading-relaxed text-muted">{FIXTURES[fixture].description}</p>
        <details className="mb-5 rounded-lg border border-line p-4">
          <summary className="focus-ring rounded font-medium">Fixture and test details</summary>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">Contract</dt><dd className="break-words">{FIXTURES[fixture].contract}</dd></div>
            <div><dt className="text-muted">Trusted test</dt><dd className="break-words">{FIXTURES[fixture].oracle}</dd></div>
            <div><dt className="text-muted">Expected outcome</dt><dd>{FIXTURES[fixture].expected}</dd></div>
            <div><dt className="text-muted">Invariant</dt><dd>{FIXTURES[fixture].invariant}</dd></div>
          </dl>
        </details>
        {children}
        <p className="mt-5 text-xs leading-relaxed text-muted">{footerNote}</p>
      </Card>
    </section>
  );
}

/** Shared live Foundry execution status, stages, verdict, and financial evidence card. */
export function LiveVerificationSection({
  current,
  message,
  canRetryStatus,
  onRetry,
}: {
  current: Job | null;
  message: string;
  canRetryStatus: boolean;
  onRetry: () => void;
}) {
  const result = current?.result ?? null;
  const verdict = result ? VERDICTS[result.status] : null;
  const numbers = financialEvidence(result) as JobResult["financialEvidence"] | null;
  const progress = stageStates(current) as (keyof typeof stageLabel)[];

  return (
    <section id="verification" className="scroll-mt-8" aria-labelledby="verification-title">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><h2 id="verification-title" className="text-2xl font-semibold">Live verification</h2></div>
        <span role="status" aria-live="polite" className="rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-forest">
          {current?.state.toUpperCase() ?? "AWAITING SUBMISSION"}
        </span>
      </div>
      <Card className="p-5 md:p-7">
        <p className="text-xs font-semibold text-muted">CURRENT JOB</p>
        <p className="mono-data mt-1 text-sm font-semibold">{current?.id ?? "No job submitted"}</p>
        <p className="mt-3 text-sm text-muted">
          {!current
            ? "Choose a reviewed fixture and press Verify PoC."
            : current.state === "finished"
              ? `Foundry run finished for ${FIXTURES[current.fixture].name}. Inspect the returned verdict and evidence.`
              : current.state === "queued"
                ? "The API accepted the fixture; execution is waiting in the queue."
                : "The trusted Foundry oracle is running. Evidence follows after completion."}
        </p>
        <ol className="mt-5 divide-y divide-line border-y border-line">
          {stages.map(([title, detail], index) => (
            <li key={title} className="flex items-center gap-3 py-4">
              <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line text-xs text-forest">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <strong className="block text-sm">{title}</strong>
                <span className="text-xs text-muted">{detail}</span>
              </div>
              <span className="text-xs font-semibold text-forest">{stageLabel[progress[index]]}</span>
            </li>
          ))}
        </ol>
        {message && <div role="alert" className="verification-error mt-5 rounded-lg p-3 text-sm">{message}</div>}
        {canRetryStatus && current && (
          <Button variant="outline" type="button" className="mt-3" onClick={onRetry}>
            <RefreshCw size={16} aria-hidden="true" />
            Retry status lookup
          </Button>
        )}
        <div className="mt-6 border-t border-line pt-5">
          <p className="mb-1 text-xs font-semibold text-muted">VERDICT</p>
          <strong className={`text-xl ${
            result?.status === "reproduced"
              ? "verification-danger"
              : result?.status === "not_reproduced"
                ? "text-forest"
                : "text-ink"
          }`}>
            {verdict?.label ?? "Awaiting run"}
          </strong>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {verdict
              ? `${verdict.explanation}${result?.reason ? ` Worker reason: ${result.reason}.` : ""}`
              : "A verdict appears only after the API returns a finished job."}
          </p>
        </div>
        <dl className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ["ATTACKER BEFORE", numbers?.attackerBefore],
            ["ATTACKER AFTER", numbers?.attackerAfter],
            ["VICTIM SHARES", numbers?.victimShares],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-page p-3">
              <dt className="text-xs font-semibold text-muted">{label}</dt>
              <dd className="mono-data mt-2 text-sm font-semibold">{value ?? "Not captured"}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-muted">
          {numbers
            ? "Measured values returned by this job's structured execution evidence."
            : "Measured values appear only when real execution returns a complete evidence set."}
        </p>
      </Card>
    </section>
  );
}

/** Shared sidebar comparing the latest vulnerable and patched fixture runs. */
export function RunComparisonAside({
  jobs,
  lastByFixture,
}: {
  jobs: Record<string, Job>;
  lastByFixture: Partial<Record<Fixture, string>>;
}) {
  return (
    <aside className="lg:sticky lg:top-6" aria-label="Run comparison">
      <Card className="p-5">
        <h2 className="mb-2 text-lg font-semibold">Run comparison</h2>
        <p className="mb-4 text-xs text-muted">Both runs use the reviewed attack sequence and trusted fixture assertions.</p>
        {fixtures.map(key => {
          const job = lastByFixture[key] ? jobs[lastByFixture[key]!] : null;
          return (
            <div key={key} className="border-t border-line py-3">
              <p className="text-xs font-semibold text-muted">{key === "vulnerable" ? "VULNERABLE VAULT" : "PATCHED CONTROL"}</p>
              <strong className="mt-1 block text-sm">
                {job?.state === "finished" && job.result
                  ? VERDICTS[job.result.status].label
                  : job?.state === "running"
                    ? "Running"
                    : job?.state === "queued"
                      ? "Queued"
                      : "Not run"}
              </strong>
              <span className="mono-data mt-1 block text-xs text-muted">{receiptDigest(job?.result) ?? "No receipt digest"}</span>
            </div>
          );
        })}
        <p className="mt-3 text-xs text-muted">A not-reproduced control result is not a general security certification.</p>
      </Card>
    </aside>
  );
}
