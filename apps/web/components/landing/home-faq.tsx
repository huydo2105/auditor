"use client";

import { useState } from "react";
import { BrandMark } from "@/components/brand/brand-mark";

const questions = [
  {
    question: <>What is <BrandMark size={23} /> VeriPoC?</>,
    answer: <p>VeriPoC is a shared security workspace for DeFi teams and independent researchers using their own AI agents. Teams set an authorized scope; researchers submit claims and supported proof references; a controlled Foundry worker returns private evidence for the tested conditions.</p>,
  },
  {
    question: "How do DeFi teams use VeriPoC?",
    answer: <div className="faq-flow">
      <ol><li>Define the contract, pinned source revision, and rules for an authorized audit program.</li><li>Invite researchers to investigate within that scope.</li><li>Review their private claims and verification evidence before deciding what to do next.</li></ol>
      <p>The current local demo uses one pre-seeded vault program. The team program form is an unsaved preview; full team triage is planned.</p>
    </div>,
  },
  {
    question: "How do security researchers use VeriPoC?",
    answer: <div className="faq-flow">
      <ol><li>Read the scope and rules of a program they are invited to investigate.</li><li>Use their own AI agent, tools, and manual review to prepare a claim.</li><li>Submit a supported proof reference, then inspect the Foundry verdict and private receipt.</li></ol>
      <p>Today the verifier accepts only the reviewed local EVM vault fixtures, not arbitrary contracts or agent-generated code.</p>
    </div>,
  },
  {
    question: "How much does VeriPoC cost?",
    answer: <p>There is no VeriPoC charge in the local demo; you run its worker on your own machine. Product pricing has not been published. Per-program or per-verification-job pricing is being evaluated, and a reproduced result never automatically triggers a bounty payout.</p>,
  },
  {
    question: "How does VeriPoC verify your AI agent using a Concordium badge?",
    answer: <div className="faq-badge-answer"><p>A Concordium CIS-8004 badge identifies an agent through an on-chain registry record. A verifier can check that the record is active and that the published Agent Card matches its on-chain SHA-256 hash. A CIS-8 binding can connect the agent to an external public key.</p><p>VeriPoC&apos;s demo <a href="https://agent-registry-mcp.concordium.com/v1/check-badge/JyP9UhUtd9AeJywDRsg5q" target="_blank" rel="noopener noreferrer">Agent #1067 badge check</a> is public. The local API can optionally verify signed requests from a specifically invited badge and key. The browser demo still uses separate team and researcher tokens; an agent gateway is planned. A valid badge establishes registry identity and card integrity; it does not prove audit skill or grant program access.</p></div>,
  },
];

export function HomeFaq() {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const allOpen = open.size === questions.length;

  function toggle(index: number) {
    setOpen(previous => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return <section id="faq" className="faq-section" aria-labelledby="faq-title">
    <div className="site-shell faq-inner">
      <div className="faq-heading"><h2 id="faq-title">Frequently asked questions</h2>
        <button type="button" className="faq-all focus-ring" onClick={() => setOpen(allOpen ? new Set() : new Set(questions.map((_, index) => index)))}>{allOpen ? "Collapse FAQs" : "View all FAQs"}</button>
      </div>
      <div className="faq-list">{questions.map((item, index) => {
        const expanded = open.has(index);
        return <div className="faq-item" key={index}>
          <h3><button type="button" className="faq-question focus-ring" aria-expanded={expanded} aria-controls={`faq-answer-${index}`} onClick={() => toggle(index)}><span>{item.question}</span><span className="faq-symbol" aria-hidden="true">{expanded ? "×" : "+"}</span></button></h3>
          <div id={`faq-answer-${index}`} className="faq-answer" hidden={!expanded}>{item.answer}</div>
        </div>;
      })}</div>
    </div>
  </section>;
}
