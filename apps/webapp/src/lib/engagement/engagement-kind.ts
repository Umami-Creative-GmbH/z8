/**
 * Engagement kind (#1995, spec #1935): whether a person works for the
 * organization as an employee or as an External Contractor. The employee row
 * carries the kind in force today; every employment period carries the kind of
 * that stint, which never changes once written.
 */
export const engagementKinds = ["employee", "contractor"] as const;
export type EngagementKind = (typeof engagementKinds)[number];

export function isEngagementKind(value: unknown): value is EngagementKind {
	return typeof value === "string" && (engagementKinds as readonly string[]).includes(value);
}

/** The constraint name migration 0328's triggers raise an in-place change under. */
export const ENGAGEMENT_KIND_IMMUTABLE_CONSTRAINT = "employee_engagement_kind_immutable";

/**
 * PostgreSQL refused changing an engagement kind in place (migration 0328): a
 * period's kind never changes, and the employee's only once no active period
 * has another kind. Follows Drizzle's `cause` chain to the driver error.
 */
export function isEngagementKindChangeRefusal(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
		const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
		if (
			candidate.code === "23514" &&
			candidate.constraint === ENGAGEMENT_KIND_IMMUTABLE_CONSTRAINT
		) {
			return true;
		}
		current = candidate.cause;
	}
	return false;
}
