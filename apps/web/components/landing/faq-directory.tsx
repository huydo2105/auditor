"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";
import { BOUNTY_DEPOSIT_CCD, FAQ_CATEGORIES, FAQ_ITEMS, type FaqCategory } from "@/lib/faq-data";

export function FaqDirectory() {
  const [category, setCategory] = useState<"all" | FaqCategory>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(() => new Set(FAQ_ITEMS.map(item => item.id)));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQ_ITEMS.filter(item => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      const haystack = [item.question, ...item.paragraphs, ...(item.steps ?? [])].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [category, query]);

  const allOpen = visible.length > 0 && visible.every(item => open.has(item.id));

  function toggle(id: string) {
    setOpen(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setOpen(allOpen ? new Set() : new Set(visible.map(item => item.id)));
  }

  return (
    <main id="main" className="site-shell faq-page">
      <Link href="/" className="back-link focus-ring"><ArrowLeft size={16} aria-hidden="true" /> Back to home</Link>
      <section className="faq-page-hero" aria-labelledby="faq-page-title">
        <h1 id="faq-page-title">Frequently asked questions</h1>
        <p>Everything DeFi teams and security researchers need to know about authorized scopes, the {BOUNTY_DEPOSIT_CCD} CCD setup deposit, Concordium agent badges, and isolated Foundry verification.</p>
      </section>

      <div className="faq-controls">
        <div className="faq-search-wrap">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search questions (e.g. CCD deposit, badge, Foundry, private)..."
            aria-label="Search frequently asked questions"
            className="focus-ring"
          />
        </div>
        <div className="faq-control-row">
          <div className="directory-tabs" role="group" aria-label="FAQ category">
            {FAQ_CATEGORIES.map(item => (
              <button
                key={item.id}
                type="button"
                className="focus-ring"
                aria-pressed={category === item.id}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button type="button" className="faq-all focus-ring" onClick={toggleAll}>
            {allOpen ? "Collapse all" : "Expand all"}
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="faq-empty" role="status">
          <p>No FAQ entries matched &ldquo;{query}&rdquo;. Try another keyword or switch back to All topics.</p>
        </div>
      ) : (
        <div className="faq-list">
          {visible.map(item => {
            const expanded = open.has(item.id);
            return (
              <article className="faq-item" key={item.id} id={item.id}>
                <div className="faq-item-head">
                  <h2>
                    <button
                      type="button"
                      className="faq-question focus-ring"
                      aria-expanded={expanded}
                      aria-controls={`faq-panel-${item.id}`}
                      onClick={() => toggle(item.id)}
                    >
                      <span>{item.question}</span>
                      <span className="faq-symbol" aria-hidden="true">{expanded ? "×" : "+"}</span>
                    </button>
                  </h2>
                </div>
                <div id={`faq-panel-${item.id}`} className="faq-answer" hidden={!expanded}>
                  <div className="faq-flow">
                    {item.steps && <ol>{item.steps.map(step => <li key={step}>{step}</li>)}</ol>}
                    {item.paragraphs.map(text => <p key={text}>{text}</p>)}
                    {item.link && (
                      <p className="faq-badge-answer">
                        <a
                          href={item.link.href}
                          target={item.link.external ? "_blank" : undefined}
                          rel={item.link.external ? "noopener noreferrer" : undefined}
                        >
                          {item.link.label} <ArrowUpRight size={14} className="inline" aria-hidden="true" />
                        </a>
                      </p>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <section className="faq-cta" aria-label="Next steps">
        <div>
          <h2>Ready to set up an authorized bounty?</h2>
          <p>Configure your scope, select severity reward tiers, and invite verified Concordium agent badges.</p>
        </div>
        <div className="faq-cta-actions">
          <Link href="/teams/new" className="site-action site-action-dark focus-ring">Create a bounty</Link>
          <Link href="/get-started" className="site-action focus-ring">Browse opportunities</Link>
        </div>
      </section>
    </main>
  );
}
