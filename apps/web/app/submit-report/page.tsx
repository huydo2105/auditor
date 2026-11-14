import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, FileCode2, FileText, LockKeyhole, ShieldCheck } from "lucide-react";
import { VerificationConsole } from "@/components/verification/verification-console";

const steps = [
  { icon: FileCode2, title: "Read the authorized scope", description: "Start with the reviewed vault fixture, source revision, permitted environment, and exclusions." },
  { icon: Bot, title: "Investigate with your agent", description: "Use your own agent or tools to inspect code, test invariants, and form a candidate claim locally." },
  { icon: FileText, title: "Prepare a reproducible PoC", description: "Record the root cause, affected lines, impact, exact test steps, and expected result." },
  { icon: ShieldCheck, title: "Verify and inspect evidence", description: "Run the supported fixture through Foundry. Compare vulnerable and patched results and keep the receipt private." },
] as const;

export default function SubmitReportPage() {
  return <main id="main" className="site-shell submit-report">
    <Link href="/opportunities/demo-vault" className="back-link focus-ring"><ArrowLeft size={16} aria-hidden="true" /> Vault program</Link>
    <section className="submit-report-intro" aria-labelledby="submit-report-title"><p className="eyebrow">RESEARCHER WORKSPACE</p><h1 id="submit-report-title">From agent finding<br />to verified evidence.</h1><p>Bring your own AI agent, investigate the reviewed vault, and use the shared verifier to test a supported claim. Agent API/MCP submission and confidential report intake are planned.</p><a href="#submission" className="site-action site-action-dark focus-ring">Verify reviewed PoC <ArrowRight size={16} aria-hidden="true" /></a></section>
    <section className="submit-process" aria-labelledby="submit-process-title"><div className="submit-process-heading"><div><p className="eyebrow">THE RESEARCHER PATH</p><h2 id="submit-process-title">One claim, clear evidence.</h2></div><Link href="/opportunities/demo-vault" className="focus-ring">Review program scope <ArrowRight size={16} aria-hidden="true" /></Link></div><ol>{steps.map((step, index) => { const Icon = step.icon; return <li key={step.title}><span className="submit-process-icon"><Icon size={22} aria-hidden="true" /></span><span className="submit-process-number">0{index + 1}</span><h3>{step.title}</h3><p>{step.description}</p></li>; })}</ol></section>
    <div className="submit-boundary"><LockKeyhole size={18} aria-hidden="true" /><p>Today’s console accepts only the reviewed vulnerable and patched local fixtures. It does not accept agent-generated code, arbitrary contract uploads, or external targets.</p></div>
    <VerificationConsole embedded />
  </main>;
}
