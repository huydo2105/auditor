"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ArrowUpRight, Copy } from "lucide-react";
import bounties from "@/public/data/bug-bounties.json";

type Bounty = (typeof bounties)[number];
type Field = "title" | "asset" | "impact" | "reproduction" | "tools";
const fieldNames: { key: Field; label: string; placeholder: string; required: boolean }[] = [
  { key: "title", label: "Finding title", placeholder: "Describe the suspected issue", required: true },
  { key: "asset", label: "Affected asset and revision", placeholder: "Use the exact target from the official scope", required: true },
  { key: "impact", label: "Impact and broken invariant", placeholder: "What could go wrong, and under which conditions?", required: true },
  { key: "reproduction", label: "Reproduction steps and PoC", placeholder: "Record the local test, inputs, expected result and observed result", required: true },
  { key: "tools", label: "Research tools or agent used", placeholder: "Optional: describe tools and human review", required: false },
];
const blank: Record<Field, string> = { title: "", asset: "", impact: "", reproduction: "", tools: "" };

export function ExternalReportDraft({ bounty }: { bounty: Bounty }) {
  const [draft, setDraft] = useState(blank);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");

  function formatReport() {
    return `# ${draft.title.trim()}\n\nProgram: ${bounty.title}\nOfficial rules: ${bounty.programUrl}\nOfficial scope: ${bounty.scopeUrl}\n\n## Affected asset and revision\n${draft.asset.trim()}\n\n## Impact and invariant\n${draft.impact.trim()}\n\n## Reproduction and PoC\n${draft.reproduction.trim()}\n\n## Tools and agent\n${draft.tools.trim() || "Not specified"}`;
  }

  async function copyReport() {
    try { await navigator.clipboard.writeText(formatReport()); setMessage("Draft copied. Review it before sharing through the official program."); }
    catch { setMessage("Clipboard unavailable. Select and copy the draft below."); }
  }

  return <main id="main" className="site-shell submit-report external-report-draft">
    <Link href={`/opportunities/${bounty.id}`} className="back-link focus-ring"><ArrowLeft size={16} aria-hidden="true" /> {bounty.title} scope</Link>
    <header className="report-wizard-hero"><p className="eyebrow">Finding preparation</p><h1>{review ? "Review your finding." : `Prepare a finding for ${bounty.title}.`}</h1><p>Read the current program rules, prepare a reproducible finding, and complete the submission on the official program site. This draft stays in this browser page.</p></header>
    <div className="external-report-layout"><aside className="external-report-rules" aria-label="Program rules"><h2>Before you investigate</h2><ul>{bounty.instructions.map(item => <li key={item}>{item}</li>)}</ul><a href={bounty.programUrl} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">Official instructions <ArrowUpRight size={16} aria-hidden="true" /></a><a href={bounty.scopeUrl} target="_blank" rel="noopener noreferrer" className="external-program-link focus-ring">Current scope <ArrowUpRight size={16} aria-hidden="true" /></a></aside>
      {review ? <section className="report-stage" aria-labelledby="external-review-title"><h2 id="external-review-title">Check the report before submission</h2><p>AI or tool output is a hypothesis until independently reproduced. No report has been sent to VeriPoC or the program owner.</p><pre className="report-agent-brief">{formatReport()}</pre><p role="status" aria-live="polite">{message}</p><div className="report-stage-actions"><button type="button" className="report-secondary focus-ring" onClick={() => setReview(false)}>Edit finding</button><button type="button" className="report-secondary focus-ring" onClick={() => void copyReport()}><Copy size={16} aria-hidden="true" /> Copy report</button><a href={bounty.programUrl} target="_blank" rel="noopener noreferrer" className="site-action site-action-dark focus-ring">Continue on Immunefi <ArrowUpRight size={16} aria-hidden="true" /></a></div></section>
        : <form className="report-stage" onSubmit={event => { event.preventDefault(); setMessage(""); setReview(true); }}><h2>Draft a reproducible finding</h2><p>Use the official scope to identify the affected asset. Keep unpatched exploit details private.</p><div className="report-fields">{fieldNames.map(field => <div key={field.key}><label htmlFor={`external-${field.key}`}>{field.label} {!field.required && <span className="report-optional">Optional</span>}</label>{field.key === "impact" || field.key === "reproduction" ? <textarea id={`external-${field.key}`} required={field.required} rows={field.key === "reproduction" ? 5 : 3} placeholder={field.placeholder} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} /> : <input id={`external-${field.key}`} required={field.required} placeholder={field.placeholder} value={draft[field.key]} onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))} />}</div>)}</div><div className="report-stage-actions"><button type="submit" className="site-action site-action-dark focus-ring">Review finding <ArrowRight size={16} aria-hidden="true" /></button></div></form>}
    </div>
  </main>;
}
