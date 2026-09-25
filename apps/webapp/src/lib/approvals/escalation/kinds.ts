import type { ApprovalCutoverBehavior, ApprovalWorkflowType } from "../workflow/ports";

/**
 * The approval kinds and authority modes escalation transfers (#298, #299,
 * #326). Everything else that escalation discovers is held as an explicit
 * `unsupported_route`, never routed back to channel-specific authority.
 *
 * Client-safe: no database imports.
 */

/** Kinds whose canonical assignments escalation transfers through the workflow. */
export const CANONICAL_ESCALATION_WORKFLOW_TYPES = [
	"absence",
	"manual_time_submission",
	"policy_clock_out",
	"time_correction",
] as const satisfies readonly ApprovalWorkflowType[];

export type CanonicalEscalationWorkflowType = (typeof CANONICAL_ESCALATION_WORKFLOW_TYPES)[number];

export function isCanonicalEscalationWorkflowType(
	value: unknown,
): value is CanonicalEscalationWorkflowType {
	return CANONICAL_ESCALATION_WORKFLOW_TYPES.includes(value as CanonicalEscalationWorkflowType);
}

/**
 * Legacy `approval_request` entity types escalation discovers under legacy
 * authority, with the workflow kind they belong to. Time entries are
 * discovered only to hold them: legacy and shadow time authority has no
 * transfer yet.
 */
export const LEGACY_ESCALATION_ENTITY_TYPES = {
	absence_entry: "absence",
	travel_expense_claim: "travel_expense",
	time_entry: null,
} as const;

export type LegacyEscalationEntityType = keyof typeof LEGACY_ESCALATION_ENTITY_TYPES;

/** Legacy kinds escalation transfers by moving the pending request. */
export type LegacyEscalationWorkflowType = Exclude<
	(typeof LEGACY_ESCALATION_ENTITY_TYPES)[LegacyEscalationEntityType],
	null
>;

export function isLegacyEscalationEntityType(value: unknown): value is LegacyEscalationEntityType {
	return typeof value === "string" && Object.hasOwn(LEGACY_ESCALATION_ENTITY_TYPES, value);
}

/** Kinds a management-authorized transfer can address (canonical or legacy). */
export const TRANSFERABLE_ESCALATION_APPROVAL_TYPES: readonly string[] = [
	...CANONICAL_ESCALATION_WORKFLOW_TYPES,
	"travel_expense",
];

/**
 * Why a canonical assignment's replacement would have no working inbox and
 * decision path, if so. Every admitted kind is discovered and decided on the
 * web through its canonical-to-legacy representative, which names exactly
 * one approver: without that mirror (`complete`) or beside pending parallel
 * assignments the transfer is held, not attempted.
 */
export function unsupportedCanonicalReplacementRoute(input: {
	workflowType: CanonicalEscalationWorkflowType;
	mirror: ApprovalCutoverBehavior["mirror"];
	pendingSiblingCount: number;
}): string | null {
	if (input.mirror !== "canonical_to_legacy") {
		return input.workflowType === "absence"
			? "absence_inbox_requires_compatibility_mirror"
			: "time_inbox_requires_compatibility_mirror";
	}
	if (input.pendingSiblingCount > 0) {
		return "parallel_assignments_without_replacement_inbox";
	}
	return null;
}
