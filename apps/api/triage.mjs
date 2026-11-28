const DECISIONS = new Set(["accept", "reject", "needs_info"]);
const CONFIDENCES = new Set(["low", "medium", "high"]);
const bad = message => Object.assign(new Error(message), { status: 400 });

export function validateAdvisoryNote(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("valid advisory note object required");
  const allowed = new Set(["summary", "suggestedDecision", "suggestedPatch", "confidence"]);
  if (Object.keys(body).some(key => !allowed.has(key))) throw bad("unexpected field in advisory note");
  if (typeof body.summary !== "string" || !body.summary.trim() || body.summary.trim().length > 1000) {
    throw bad("summary (1-1000 characters) is required");
  }
  if (!DECISIONS.has(body.suggestedDecision)) {
    throw bad("suggestedDecision must be accept, reject, or needs_info");
  }
  if (body.suggestedPatch !== undefined && (typeof body.suggestedPatch !== "string" || body.suggestedPatch.trim().length > 1500)) {
    throw bad("suggestedPatch must be a string up to 1500 characters");
  }
  if (body.confidence !== undefined && !CONFIDENCES.has(body.confidence)) {
    throw bad("confidence must be low, medium, or high");
  }
  return {
    summary: body.summary.trim(),
    suggestedDecision: body.suggestedDecision,
    ...(body.suggestedPatch?.trim() ? { suggestedPatch: body.suggestedPatch.trim() } : {}),
    confidence: body.confidence ?? "medium",
    advisory: true,
    canFinalize: false,
  };
}

export function validateTriageDecision(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("valid triage decision object required");
  const keys = Object.keys(body).sort().join();
  if (keys !== "decision,rationale") throw bad("decision and rationale are required");
  if (!DECISIONS.has(body.decision)) throw bad("decision must be accept, reject, or needs_info");
  if (typeof body.rationale !== "string" || !body.rationale.trim() || body.rationale.trim().length > 1000) {
    throw bad("rationale (1-1000 characters) is required");
  }
  return { decision: body.decision, rationale: body.rationale.trim() };
}

export function buildInboxPayload({ submissions, jobs, actor }) {
  const visibleSubmissions = [...submissions.values()].filter(
    item => actor.role === "team" || item.authorId === actor.id,
  );
  const items = [];
  for (const sub of visibleSubmissions) {
    const subJobs = [...(sub.jobIds ?? []), ...(sub.patchRetestJobIds ?? [])]
      .map(id => jobs.get(id))
      .filter(Boolean);

    items.push({
      id: `finding:${sub.id}`,
      category: "new_finding",
      programId: sub.programId,
      submissionId: sub.id,
      title: sub.report?.title ?? `Claim: ${sub.claim}`,
      summary: sub.report?.impact ?? `Submitted by ${sub.authorId} against ${sub.targetSha256.slice(0, 12)}…`,
      actorId: sub.authorId,
      createdAt: sub.createdAt,
      status: sub.triage?.decision ?? "pending_review",
    });

    if (sub.authorId.startsWith("agent:")) {
      items.push({
        id: `badge:${sub.id}`,
        category: "badge",
        programId: sub.programId,
        submissionId: sub.id,
        title: `Verified Concordium Agent Badge (${sub.authorId.slice(6)})`,
        summary: `CIS-8004 badge & CIS-8 key verified for submission ${sub.id.slice(0, 8)}…`,
        actorId: sub.authorId,
        createdAt: sub.createdAt,
        status: "verified",
      });
    }

    for (const note of sub.advisoryNotes ?? []) {
      items.push({
        id: `note:${note.id}`,
        category: "status_change",
        programId: sub.programId,
        submissionId: sub.id,
        title: `Advisory agent recommendation: ${note.suggestedDecision}`,
        summary: note.summary,
        actorId: note.authorId,
        createdAt: note.createdAt,
        status: "advisory",
      });
    }

    if (sub.triage) {
      items.push({
        id: `triage:${sub.id}`,
        category: "status_change",
        programId: sub.programId,
        submissionId: sub.id,
        title: `Team triage decision: ${sub.triage.decision}`,
        summary: sub.triage.rationale,
        actorId: sub.triage.decidedBy,
        createdAt: sub.triage.decidedAt,
        status: sub.triage.decision,
      });
    }

    for (const job of subJobs) {
      if (job.isPatchRetest) {
        items.push({
          id: `retest:${job.id}`,
          category: "status_change",
          programId: sub.programId,
          submissionId: sub.id,
          jobId: job.id,
          title: `Patch retest (${job.body.fixture}): ${job.result?.status ?? job.state}`,
          summary: job.result?.receipt?.receiptHash
            ? `Receipt ${job.result.receipt.receiptHash.slice(0, 16)}…`
            : `Job ${job.state}`,
          actorId: job.authorId,
          createdAt: job.createdAt,
          status: job.result?.status ?? job.state,
        });
      }
    }
  }

  const enrichedSubmissions = visibleSubmissions.map(sub => {
    const mapJob = id => {
      const j = jobs.get(id);
      if (!j) return null;
      return {
        id: j.id,
        fixture: j.body.fixture,
        state: j.state,
        isPatchRetest: Boolean(j.isPatchRetest),
        verdict: j.result?.status ?? null,
        receiptHash: j.result?.receipt?.receiptHash ?? null,
        anchor: j.anchor ?? null,
        result: j.result,
      };
    };
    return {
      ...sub,
      jobs: (sub.jobIds ?? []).map(mapJob).filter(Boolean),
      patchRetestJobs: (sub.patchRetestJobIds ?? []).map(mapJob).filter(Boolean),
    };
  });

  const counts = {
    all: items.length,
    new_finding: items.filter(i => i.category === "new_finding").length,
    status_change: items.filter(i => i.category === "status_change").length,
    payment: items.filter(i => i.category === "payment").length,
    badge: items.filter(i => i.category === "badge").length,
  };

  return { actor, counts, items, submissions: enrichedSubmissions };
}
