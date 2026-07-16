// Pure, testable helpers for the desk's human-review gate and proposal shaping.
// The gate MUST match the Worker's server-side rule in /api/desk/propose
// (defense in depth): anything that names a private individual, or is below 0.75
// confidence — including invalid/NaN confidence — is forced to human review.
// Tested by test/proposal.test.js.

export interface ProposalGateInput {
  names_individuals?: boolean;
  confidence?: number;
}

/** True if the proposal must go to human review before it can be published. */
export function gateProposal(args: ProposalGateInput): boolean {
  const highConfidence = Number.isFinite(args.confidence as number) && (args.confidence as number) >= 0.75;
  return Boolean(args.names_individuals) || !highConfidence;
}

/** Stable, safe kebab-case slug: lowercase, illegal runs -> "-", trimmed, <=80. */
export function sanitizeSlug(slug: string): string {
  return String(slug)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Shape the queued record: stamp the review flag + timestamp, preserve fields. */
export function buildRecord<T extends ProposalGateInput>(
  args: T,
  nowIso: string,
): T & { needs_human_review: boolean; queued_at: string } {
  return { ...args, needs_human_review: gateProposal(args), queued_at: nowIso };
}
