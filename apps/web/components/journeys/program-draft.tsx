"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Coins, Globe, LockKeyhole, Mail, Plus, Send, Trash2 } from "lucide-react";
import { BOUNTY_DEPOSIT_CCD } from "@/lib/faq-data";
import { publishProgram, serializeContacts, type ContactChannel, type ContactInput, type ReferenceInput, type RewardInput } from "@/lib/publish-program";

type Field = { key: string; label: string; hint: string; multiline?: boolean; required?: boolean; type?: string; placeholder?: string };

const steps: { title: string; intro: string; fields: Field[] }[] = [
  { title: "Project", intro: "Name the program and identify the team responsible for reviewing reports.", fields: [
    { key: "name", label: "Project name", hint: "Example: My vault review", required: true },
    { key: "visibility", label: "Program visibility", hint: "Public scope is visible to everyone. Private scope requires an invitation.", required: true },
    { key: "agentBadge", label: "Invite agent badges", hint: "Optional signed Concordium agent badges for private scope, one badge ID per line.", multiline: true, placeholder: "Enter one Concordium agent badge ID per line" },
  ] },
  { title: "Instructions", intro: "Tell researchers and their own AI agents what to investigate and how to prepare a reproducible claim.", fields: [
    { key: "instructions", label: "System overview and investigation goals", hint: "Describe assets, trust boundaries, entry points, and the contract behaviors researchers should inspect.", multiline: true, required: true },
    { key: "invariants", label: "Security invariants", hint: "State properties that must always hold, such as deposited assets never minting zero shares or unauthorized withdrawals never succeeding.", multiline: true },
    { key: "submission", label: "Required finding format", hint: "Ask for affected file and revision, root cause, impact, exact runnable PoC command, expected and observed results, and suggested mitigation.", multiline: true },
  ] },
  { title: "Scope", intro: "List exactly what may be tested. A source revision and environment make reproduction meaningful.", fields: [
    { key: "sourceUrl", label: "Primary source repository URL", hint: "HTTPS repository URL for the pinned source", type: "url", required: true },
    { key: "sourceRevision", label: "Pinned source commit or digest", hint: "Full 40-character Git commit or 64-character source digest", required: true },
    { key: "scope", label: "Permitted contract paths, one per line", hint: "List exact repository paths or contract identifiers; up to 10.", multiline: true, required: true },
    { key: "chain", label: "Chain and test environment", hint: "evm-local, evm-testnet, or solana-testnet. New programs do not yet have worker verification.", required: true },
    { key: "runLimit", label: "Verification run limit", hint: "An integer from 1 to 20, reserved for a later verifier connection.", type: "number", required: true },
  ] },
  { title: "Exclusions", intro: "State prohibited targets and actions so researchers know where authorization ends.", fields: [
    { key: "outOfScope", label: "Out-of-scope targets", hint: "List excluded contracts, deployments, third-party services, and unsupported versions.", multiline: true },
    { key: "policy", label: "Testing and disclosure policy", hint: "State whether live-chain transactions, production disruption, social engineering, public disclosure, or third-party testing are prohibited.", multiline: true },
  ] },
  { title: "Rewards", intro: "Select severity tiers and set proposed USD ranges.", fields: [
    { key: "eligibility", label: "Eligibility and decision policy", hint: "Explain how findings are reviewed and triaged against your program scope.", multiline: true },
  ] },
  { title: "Links", intro: "Add named source, documentation, or deployment references. Extra links do not expand the permitted scope.", fields: [
    { key: "docsUrl", label: "Technical documentation URL", hint: "https://docs.example.org", type: "url" },
  ] },
  { title: "Agent setup", intro: "Generate either field from the preceding steps or write your own. AI drafting sends those details to the configured OpenAI API without wallet sign-in; review the result before publishing.", fields: [
    { key: "agentContext", label: "Agent-readable setup", hint: "Build and test commands, pinned tool versions, dependencies, and source links.", multiline: true },
    { key: "agentRules", label: "Agent permissions and tool limits", hint: "Specify allowed local tools and network behavior. Do not provide production credentials or authority outside scope.", multiline: true },
  ] },
];

export const SEVERITY_META = [
  { id: "critical", label: "Critical", color: "#8B0000" },
  { id: "high", label: "High", color: "#EF4444" },
  { id: "medium", label: "Medium", color: "#F59E0B" },
  { id: "low", label: "Low", color: "#EAB308" },
  { id: "informational", label: "Informational", color: "#A855F7" },
] as const;

const CONTACT_CHANNELS: { id: ContactChannel; label: string; placeholder: string; type: "email" | "url" }[] = [
  { id: "email", label: "Email", placeholder: "security@protocol.xyz", type: "email" },
  { id: "x", label: "X (Twitter)", placeholder: "https://x.com/yourprotocol", type: "url" },
  { id: "linkedin", label: "LinkedIn", placeholder: "https://linkedin.com/company/yourprotocol", type: "url" },
  { id: "discord", label: "Discord", placeholder: "https://discord.gg/yourserver", type: "url" },
  { id: "telegram", label: "Telegram", placeholder: "https://t.me/yourprotocol", type: "url" },
  { id: "github", label: "GitHub", placeholder: "https://github.com/yourorg", type: "url" },
  { id: "website", label: "Website", placeholder: "https://yourprotocol.xyz", type: "url" },
];

function ContactIcon({ channel }: { channel: ContactChannel }) {
  switch (channel) {
    case "email": return <Mail size={16} aria-hidden="true" />;
    case "x": return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
    case "linkedin": return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
      </svg>
    );
    case "discord": return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
      </svg>
    );
    case "telegram": return <Send size={16} aria-hidden="true" />;
    case "github": return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    );
    case "website": return <Globe size={16} aria-hidden="true" />;
  }
}

const initialRewards: RewardInput[] = SEVERITY_META.map(item => ({ severity: item.id, min: "0", max: "0" }));

export function ProgramDraft() {
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({ visibility: "private" });
  const [contacts, setContacts] = useState<ContactInput[]>([{ channel: "email", value: "" }]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>(["critical", "high", "medium"]);
  const [rewards, setRewards] = useState<RewardInput[]>(initialRewards);
  const [references, setReferences] = useState<ReferenceInput[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [generating, setGenerating] = useState<"agentContext" | "agentRules" | null>(null);
  const [generationError, setGenerationError] = useState<{ field: string; message: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const current = steps[step];
  const fieldsFor = (index: number) => steps[index].fields.filter(field =>
    values.visibility === "private" || field.key !== "agentBadge");

  function changed(key: string, value: string) {
    setValues(previous => ({ ...previous, [key]: value,
      ...(key === "visibility" && value === "public" ? { agentBadge: "" } : {}) }));
    setReviewed(false); setSavedId(null); setPublishError(""); setGenerationError(null);
  }

  function contactChanged(index: number, key: keyof ContactInput, value: string) {
    setContacts(previous => previous.map((item, i) => i === index ? { ...item, [key]: value } : item));
    setReviewed(false); setSavedId(null); setPublishError("");
  }

  function toggleSeverity(id: string) {
    setSelectedSeverities(previous =>
      previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]
    );
    setReviewed(false); setSavedId(null);
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setReviewed(false);
    if (step < steps.length - 1) { setStep(step + 1); return; }
    const missing = steps.findIndex((_, index) => fieldsFor(index).some(field => field.required && !values[field.key]?.trim()));
    if (missing !== -1) { setStep(missing); setError("Complete the required fields in this section before previewing."); return; }
    setReviewed(true);
  }

  function rewardChanged(severity: string, key: "min" | "max", value: string) {
    setRewards(previous => previous.map(item => item.severity === severity ? { ...item, [key]: value } : item));
    setReviewed(false); setSavedId(null);
  }

  function referenceChanged(index: number, key: keyof ReferenceInput, value: string) {
    setReferences(previous => previous.map((item, i) => i === index ? { ...item, [key]: value } : item));
    setReviewed(false); setSavedId(null);
  }

  async function generateSetup(field: "agentContext" | "agentRules") {
    setGenerating(field); setGenerationError(null);
    try {
      const additionalContext = { submissionFormat: values.submission ?? "", eligibility: values.eligibility ?? "",
        docsUrl: values.docsUrl ?? "", runLimit: values.runLimit ?? "", depositCcd: BOUNTY_DEPOSIT_CCD,
        rewards: rewards.filter(item => selectedSeverities.includes(item.severity)), references };
      const response = await fetch("/v1/programs/agent-setup", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, name: values.name, sourceUrl: values.sourceUrl, sourceRevision: values.sourceRevision,
          chain: values.chain, permittedTargets: values.scope, instructions: values.instructions,
          invariants: values.invariants ?? "", exclusions: values.outOfScope ?? "", policy: values.policy ?? "",
          additionalContext: JSON.stringify(additionalContext) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "AI draft is unavailable.");
      if (typeof result.value !== "string") throw new Error("AI draft is unavailable.");
      setValues(previous => ({ ...previous, [field]: result.value }));
      setReviewed(false); setSavedId(null);
    } catch (cause) { setGenerationError({ field, message: cause instanceof Error ? cause.message : "AI draft is unavailable." }); }
    finally { setGenerating(null); }
  }

  async function publish() {
    setPublishing(true);
    setPublishError("");
    try { setSavedId(await publishProgram(values, rewards, references, contacts, selectedSeverities)); }
    catch (cause) { setPublishError(cause instanceof Error ? cause.message : "Program could not be saved."); }
    finally { setPublishing(false); }
  }

  const serializedContact = serializeContacts(contacts);
  const visibleSeverities = SEVERITY_META.filter(item => selectedSeverities.includes(item.id));
  const requiredFields = steps.flatMap((_, index) => fieldsFor(index)).filter(field => field.required);
  const completedRequiredCount = requiredFields.filter(field => Boolean(values[field.key]?.trim())).length;
  const missingSteps = steps
    .map((item, index) => ({
      index,
      title: item.title,
      missing: fieldsFor(index).some(field => field.required && !values[field.key]?.trim()),
    }))
    .filter(item => item.missing);
  const allRequiredComplete = missingSteps.length === 0;
  const canCreateBounty = allRequiredComplete && (reviewed || step === steps.length - 1);

  return <main id="main" className="site-shell draft-page">
    <Link href="/get-started" className="back-link focus-ring"><ArrowLeft size={16} aria-hidden="true" /> Back to opportunities</Link>
    <div className="section-head"><h1>Create a bug bounty project</h1><p>Build clear instructions and an authorized scope for independent researchers and their AI agents. Watch your outline update live, then publish it with your Concordium team account.</p></div>

    <div className="draft-workspace">
      <nav aria-label="Draft sections" className="draft-steps draft-steps-vertical">
        {steps.map((item, index) => {
          const stepHasRequired = fieldsFor(index).some(field => field.required);
          const stepComplete = stepHasRequired
            ? fieldsFor(index).every(field => !field.required || Boolean(values[field.key]?.trim()))
            : index < step;
          return (
            <button
              type="button"
              key={item.title}
              className={`focus-ring${stepComplete ? " is-complete" : ""}`}
              aria-current={step === index ? "step" : undefined}
              onClick={() => { setStep(index); setError(""); }}
            >
              <span aria-hidden="true">
                {stepComplete ? <Check size={14} /> : String(index + 1).padStart(2, "0")}
              </span>
              {item.title}
            </button>
          );
        })}
      </nav>

      <div className="draft-workspace-main">
        <div className="draft-stage">
          <div className="draft-stage-heading">
            <span>STEP {String(step + 1).padStart(2, "0")} OF {String(steps.length).padStart(2, "0")}</span>
            <h2>{current.title}</h2>
            <p>{current.intro}</p>
          </div>
          {error && <p role="alert" className="draft-error">{error}</p>}
          <form className="draft-form" onSubmit={next} key={current.title}>
            {fieldsFor(step).map(field => <div className="draft-field" key={field.key}>
              <div className={`draft-field-title${current.title === "Agent setup" ? " draft-field-title-action" : ""}`}><label htmlFor={field.key}>{field.label}{field.required && <span className="sr-only"> (required)</span>}</label><span className="draft-help-wrap"><button type="button" className="draft-help focus-ring" aria-label={`Help for ${field.label}`} aria-describedby={`${field.key}-help`}>*</button><span className="draft-help-tip" id={`${field.key}-help`} role="tooltip">{field.hint}</span></span>{current.title === "Agent setup" && <button type="button" className="draft-generate-button focus-ring" disabled={Boolean(generating)} onClick={() => generateSetup(field.key as "agentContext" | "agentRules")}>{generating === field.key ? "Generating…" : "Generate with AI"}<span className="sr-only"> for {field.label}</span></button>}</div>
              {field.key === "chain" ? <select id={field.key} value={values.chain ?? ""} required onChange={event => changed(field.key, event.target.value)}><option value="">Choose environment</option><option value="evm-local">EVM local</option><option value="evm-testnet">EVM testnet</option><option value="solana-testnet">Solana testnet</option></select>
                : field.key === "visibility" ? <select id={field.key} value={values.visibility} onChange={event => changed(field.key, event.target.value)}><option value="private">Private — invitation required</option><option value="public">Public — scope visible to everyone</option></select>
                : field.multiline ? <textarea id={field.key} value={values[field.key] ?? ""} onChange={event => changed(field.key, event.target.value)} required={field.required} maxLength={2000} rows={5} placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`} />
                  : <input id={field.key} type={field.type ?? "text"} min={field.key === "runLimit" ? 1 : undefined} max={field.key === "runLimit" ? 20 : undefined} value={values[field.key] ?? ""} onChange={event => changed(field.key, event.target.value)} required={field.required} maxLength={300} placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`} />}
              {generationError?.field === field.key && <p role="alert" className="draft-error">{generationError.message}</p>}
            </div>)}

            {current.title === "Project" && (
              <div className="contact-editor">
                <div className="draft-field-title">
                  <span className="contact-editor-label">Team contact</span>
                  <span className="draft-help-wrap">
                    <button type="button" className="draft-help focus-ring" aria-label="Help for Team contact" aria-describedby="team-contact-help">*</button>
                    <span className="draft-help-tip" id="team-contact-help" role="tooltip">Add one or more official channels (Email, X, LinkedIn, Discord, Telegram, GitHub, or Website) for researcher follow-up.</span>
                  </span>
                </div>
                {contacts.map((contact, index) => {
                  const channelMeta = CONTACT_CHANNELS.find(c => c.id === contact.channel) ?? CONTACT_CHANNELS[0];
                  return (
                    <div key={index} className="contact-row">
                      <div className="contact-channel-wrap">
                        <span className="contact-channel-icon"><ContactIcon channel={contact.channel} /></span>
                        <select
                          aria-label={`Contact channel ${index + 1}`}
                          value={contact.channel}
                          onChange={event => contactChanged(index, "channel", event.target.value)}
                        >
                          {CONTACT_CHANNELS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                        </select>
                      </div>
                      <input
                        aria-label={`Contact value ${index + 1}`}
                        type={channelMeta.type}
                        value={contact.value}
                        onChange={event => contactChanged(index, "value", event.target.value)}
                        maxLength={200}
                        placeholder={channelMeta.placeholder}
                      />
                      {contacts.length > 1 && (
                        <button
                          type="button"
                          className="reference-remove focus-ring"
                          aria-label={`Remove contact ${index + 1}`}
                          onClick={() => { setContacts(items => items.filter((_, i) => i !== index)); setReviewed(false); setSavedId(null); }}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
                <div className="contact-add-wrap">
                  <button
                    type="button"
                    className="draft-back reference-add focus-ring"
                    disabled={contacts.length >= 6}
                    aria-expanded={contactPickerOpen}
                    aria-haspopup="menu"
                    onClick={() => setContactPickerOpen(open => !open)}
                  >
                    <Plus size={16} aria-hidden="true" /> Add contact link
                  </button>
                  {contactPickerOpen && (
                    <div className="contact-picker-menu" role="menu" aria-label="Choose social media channel">
                      {CONTACT_CHANNELS.map(option => (
                        <button
                          key={option.id}
                          type="button"
                          role="menuitem"
                          className="contact-picker-item focus-ring"
                          onClick={() => {
                            setContacts(items => [...items, { channel: option.id, value: "" }]);
                            setContactPickerOpen(false);
                            setReviewed(false);
                            setSavedId(null);
                          }}
                        >
                          <ContactIcon channel={option.id} />
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {current.title === "Rewards" && (
              <div className="reward-editor">
                <p>Select the severity tiers you want to reward and set proposed USD ranges.</p>
                <div className="severity-selector" role="group" aria-label="Select severity tiers">
                  {SEVERITY_META.map(item => {
                    const active = selectedSeverities.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`severity-chip focus-ring${active ? " is-active" : ""}`}
                        aria-pressed={active}
                        onClick={() => toggleSeverity(item.id)}
                      >
                        <span className="severity-dot" style={{ backgroundColor: item.color }} aria-hidden="true" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
                {visibleSeverities.length > 0 ? (
                  <div className="reward-grid" role="group" aria-label="Severity reward ranges">
                    {visibleSeverities.map(meta => {
                      const item = rewards.find(r => r.severity === meta.id) ?? { severity: meta.id, min: "0", max: "0" };
                      return (
                        <div key={meta.id} className="reward-row">
                          <strong className="severity-label">
                            <span className="severity-dot" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                            {meta.label}
                          </strong>
                          <label>Minimum USD<input type="number" min="0" max="100000000" value={item.min} onChange={event => rewardChanged(meta.id, "min", event.target.value)} /></label>
                          <label>Maximum USD<input type="number" min="0" max="100000000" value={item.max} onChange={event => rewardChanged(meta.id, "max", event.target.value)} /></label>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="draft-small-note">No severity tiers selected. Toggle any severity above to configure USD reward ranges.</p>
                )}
              </div>
            )}

            {current.title === "Links" && <div className="reference-editor"><h3>Additional references</h3><p>Use named rows for source repositories, documentation, or deployed addresses.</p>{references.map((reference, index) => <div key={index} className="reference-row"><label>Type<select value={reference.kind} onChange={event => referenceChanged(index, "kind", event.target.value as ReferenceInput["kind"])}><option value="source">Source</option><option value="documentation">Documentation</option><option value="deployment">Deployment</option></select></label><label>Name<input value={reference.name} onChange={event => referenceChanged(index, "name", event.target.value)} maxLength={100} required /></label><label>HTTPS link or address<input value={reference.url} onChange={event => referenceChanged(index, "url", event.target.value)} maxLength={300} required /></label><button type="button" className="reference-remove focus-ring" aria-label={`Remove reference ${index + 1}`} onClick={() => { setReferences(items => items.filter((_, i) => i !== index)); setReviewed(false); setSavedId(null); }}><Trash2 size={16} aria-hidden="true" /></button></div>)}<button type="button" className="draft-back reference-add focus-ring" disabled={references.length >= 12} onClick={() => { setReferences(items => [...items, { kind: "source", name: "", url: "" }]); setReviewed(false); setSavedId(null); }}><Plus size={16} aria-hidden="true" /> Add reference</button></div>}
            <div className="draft-actions">
              {step > 0 ? <button type="button" className="draft-back focus-ring" onClick={() => setStep(step - 1)}>Previous</button> : <span />}
              {step < steps.length - 1 && (
                <button type="submit" className="site-action site-action-dark focus-ring">
                  Continue <ArrowRight size={16} aria-hidden="true" />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      <aside className="draft-preview draft-preview-sticky" aria-label="Program draft preview">
        <div className="draft-preview-top">
          <div className="draft-preview-head"><LockKeyhole size={16} aria-hidden="true" /> {savedId ? "Saved program" : "Unsaved local preview"}</div>
          <span className="draft-progress-label">{completedRequiredCount}/{requiredFields.length} required</span>
        </div>
        <div className="draft-progress-track" aria-hidden="true">
          <div className="draft-progress-fill" style={{ width: `${Math.round((completedRequiredCount / Math.max(requiredFields.length, 1)) * 100)}%` }} />
        </div>

        <div className="draft-preview-body" aria-live="polite">
          <h2>{values.name?.trim() || "Your project outline"}</h2>
          <div className="draft-preview-badges">
            <span className="draft-meta-pill">{values.visibility === "public" ? "Public scope" : "Private · invite only"}</span>
            {values.chain && <span className="draft-meta-pill">{values.chain}</span>}
          </div>
          <dl>
            {steps.flatMap((_, index) => fieldsFor(index)).filter(field => field.key !== "name" && field.key !== "visibility" && field.key !== "chain" && values[field.key]?.trim()).map(field => (
              <div key={field.key}><dt>{field.label}</dt><dd className="whitespace-pre-wrap">{values[field.key]}</dd></div>
            ))}
            {serializedContact && <div><dt>Team contact</dt><dd>{serializedContact}</dd></div>}
            <div>
              <dt>Reward ranges</dt>
              <dd className="reward-preview-list">
                {visibleSeverities.length > 0 ? visibleSeverities.map(meta => {
                  const item = rewards.find(r => r.severity === meta.id);
                  return (
                    <span key={meta.id} className="reward-preview-item">
                      <span className="severity-dot" style={{ backgroundColor: meta.color }} aria-hidden="true" />
                      {meta.label}: ${item?.min || 0}–${item?.max || 0}
                    </span>
                  );
                }) : "None selected"}
              </dd>
            </div>
            <div><dt>Additional references</dt><dd>{references.length ? references.map(item => `${item.name || "Untitled"}: ${item.url || "No link"}`).join("\n") : "None"}</dd></div>
            <div><dt>Status</dt><dd>{savedId ? "Published · verification not configured" : canCreateBounty ? "Ready to publish" : "Draft in progress · not published"}</dd></div>
          </dl>
        </div>

        <div className="draft-preview-footer">
          <div className="deposit-callout" role="note">
            <Coins size={18} aria-hidden="true" />
            <div>
              <strong>Bounty setup deposit: {BOUNTY_DEPOSIT_CCD} CCD</strong>
              <p>Publishing an authorized bounty requires a refundable {BOUNTY_DEPOSIT_CCD} CCD anti-spam bond on Concordium (separate from researcher rewards). <Link href="/faq#ccd-deposit">Read FAQ</Link></p>
            </div>
          </div>

          {publishError && <p role="alert" className="draft-error">{publishError}</p>}

          {!savedId ? (
            <>
              <button
                type="button"
                className="site-action site-action-dark draft-publish-btn focus-ring"
                disabled={!canCreateBounty || publishing}
                onClick={publish}
              >
                {publishing ? "Creating bounty…" : "Create bounty"}
                <ArrowRight size={16} aria-hidden="true" />
              </button>
            </>
          ) : (
            <Link className="site-action site-action-dark draft-publish-btn focus-ring" href={`/programs/${savedId}`}>
              Open saved program <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </aside>
    </div>
  </main>;
}
