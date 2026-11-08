import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";

/** The assignment level that decides an employee's change policy. */
export type ChangePolicyLevel = "employee" | "team" | "organization";

/** One change-policy assignment with its policy's scope and state, as read for resolution. */
export type ChangePolicyCandidate = {
	assignmentId: string;
	level: ChangePolicyLevel;
	/** The assignment's organization. */
	organizationId: string;
	employeeId: string | null;
	teamId: string | null;
	assignmentActive: boolean;
	effectiveFrom: Instant | null;
	effectiveUntil: Instant | null;
	policyOrganizationId: string;
	policyActive: boolean;
};

/** Whose change policy is resolved: an employee, or someone previewed without one. */
export type ChangePolicySubject = {
	organizationId: string;
	employeeId: string | null;
	teamId: string | null;
};

const LEVELS: readonly ChangePolicyLevel[] = ["employee", "team", "organization"];

/**
 * The change policy in effect for `subject` at `at`, or null when none applies (no
 * restrictions). A candidate counts when its assignment and policy are active and belong to the
 * subject's organization, and the assignment has started by `at` and not expired at `at`.
 * Employee, then team, then organization.
 *
 * Partial unique indexes allow one active assignment per organization, team and employee, so two
 * candidates at one level are a broken invariant: it throws rather than pick one.
 */
export function resolveChangePolicy<C extends ChangePolicyCandidate>(
	candidates: readonly C[],
	subject: ChangePolicySubject,
	at: Instant,
): C | null {
	for (const level of LEVELS) {
		const applying = candidates.filter(
			(candidate) => matchesLevel(candidate, level, subject) && applies(candidate, subject, at),
		);
		if (applying.length > 1) {
			throw new Error(`More than one ${level} change-policy assignment applies`, {
				cause: { assignmentIds: applying.map((candidate) => candidate.assignmentId) },
			});
		}
		const [row] = applying;
		if (row) return row;
	}
	return null;
}

function matchesLevel(
	candidate: ChangePolicyCandidate,
	level: ChangePolicyLevel,
	subject: ChangePolicySubject,
) {
	if (candidate.level !== level) return false;
	if (level === "employee") {
		return subject.employeeId !== null && candidate.employeeId === subject.employeeId;
	}
	if (level === "team") return subject.teamId !== null && candidate.teamId === subject.teamId;
	return true;
}

function applies(candidate: ChangePolicyCandidate, subject: ChangePolicySubject, at: Instant) {
	return (
		candidate.organizationId === subject.organizationId &&
		candidate.policyOrganizationId === subject.organizationId &&
		candidate.assignmentActive &&
		candidate.policyActive &&
		(candidate.effectiveFrom === null || compareInstants(candidate.effectiveFrom, at) <= 0) &&
		(candidate.effectiveUntil === null || compareInstants(candidate.effectiveUntil, at) > 0)
	);
}
