import type { ApprovalWorkflowType } from "../workflow/types";

/**
 * Approval route preview vocabulary (Approvals glossary: Approval route, Approval route preview,
 * Prospective requester). Worked out live and never stored.
 */

/** The approval kinds an approval route preview covers, in display order. */
export const APPROVAL_ROUTE_KINDS = [
	"absence",
	"time_correction",
	"manual_time_submission",
	"period_submission",
	"travel_expense",
	"shift_request",
] as const satisfies readonly ApprovalWorkflowType[];

export type ApprovalRouteKind = (typeof APPROVAL_ROUTE_KINDS)[number];

/**
 * Whose approval routes are previewed: an employee of the organization, or a prospective
 * requester, keyed by the caller and previewed as a member of `teamId` (or of no team) with no
 * managers, groups, user account or elevated role.
 *
 * Known limit: a prospective requester is always previewed with the role `employee`, even when
 * they were invited with another role.
 */
export type ApprovalRouteRequester =
	| { kind: "employee"; employeeId: string }
	| { kind: "prospective"; key: string; teamId: string | null };

/** The key a requester's routes are found under in {@link ApprovalRoutePreview.routes}. */
export function approvalRouteRequesterKey(requester: ApprovalRouteRequester): string {
	return requester.kind === "employee"
		? `employee:${requester.employeeId}`
		: `prospective:${requester.key}`;
}

/** Why the request path writes no request, so no approver is needed. */
export type ApprovalRouteSkipReason =
	/** Manual work: no change policy applies. */
	| "change_policy_no_policy"
	/** Manual work: the change policy is in trust mode. */
	| "change_policy_trust_mode"
	/** Owners and admins record their own manual work directly. */
	| "owner_admin_self"
	/** No active absence category requires approval. */
	| "no_category_requires_approval";

/** Why submitting would fail. */
export type ApprovalRouteUnroutableReason =
	/** No policy matches and the requester has no eligible manager to default to. */
	| { code: "no_default_approver" }
	/** The requester's manager has left and nobody stands in for them. */
	| { code: "default_approver_departed" }
	/** The matching policy has a stage nobody eligible resolves to. */
	| { code: "policy_unresolvable"; policyId: string; policyName: string }
	/** The organization's approval policies can't be read as a request would read them. */
	| { code: "invalid_policies" }
	/** Expense reports would route to the requester themselves, which submitting refuses. */
	| { code: "self_approval_route" }
	/** The kind can't be submitted in the organization's approval mode. */
	| { code: "approval_mode_unsupported" }
	/** Nobody may decide shift requests. */
	| { code: "no_decider" };

/**
 * Why a requester edits their own time entries directly. Deletion requests and date-changing
 * edits always go to approval, so a time correction is still routed.
 */
export type ApprovalDirectChange =
	| "change_policy_no_policy"
	| "change_policy_trust_mode"
	| "change_policy_within_self_service";

/** Something about a route worth saying that does not change whether it is routed. */
export type ApprovalRouteNote =
	/** Time corrections: some changes skip approval; the route is for those that don't. */
	| { code: "direct_change"; cause: ApprovalDirectChange }
	/**
	 * Manual work: entries within the change policy's self-service days need no approval. The
	 * preview has no entry, so it shows the route for one that does.
	 */
	| { code: "within_self_service_skips"; selfServiceDays: number }
	/** Expense reports: currency and item rules are checked against the report when submitted. */
	| { code: "report_contents_checked_at_submit" }
	/** Expense reports: the owner approves their own report because nobody else can (#679). */
	| { code: "owner_self_approval" }
	/** Shift requests: the requester is the only decider, so theirs wait for their own decision. */
	| { code: "requester_only_decider" };

/**
 * A canonical stage resolved as it would activate, later stages included (`traceStages`). A later
 * stage resolves as the transition engine activates it once the stages before it decide.
 */
export interface ApprovalRouteStageTrace {
	resolution: "human" | "requester_auto_approve" | "unresolvable";
	approverEmployeeIds: string[];
	/** The approvers come from the stage's fallback: with a `fail` fallback it would find nobody else. */
	viaFallback: boolean;
	/** The approver the stage names, if any, and whether they are still active at the instant. */
	namedApprover: { employeeId: string; active: boolean } | null;
}

/** One stage of a route. Later canonical stages activate only once earlier ones decide. */
export interface ApprovalRouteStage {
	sequence: number;
	label: string | null;
	approverType: string;
	fallbackBehavior: string | null;
	approverEmployeeIds: string[];
	activation: "human" | "requester_auto_approve" | "not_activated";
	/** How the stage resolves, every stage included; only when previewed with `traceStages`. */
	trace?: ApprovalRouteStageTrace;
}

/** What a request of one variant would do. */
export type ApprovalRouteOutcome =
	| {
			kind: "routed";
			path: "canonical" | "legacy" | "shift_deciders";
			/** The matched approval policy, or null for the default approver. */
			policy: { id: string; name: string } | null;
			defaultApproverEmployeeId: string | null;
			stages: ApprovalRouteStage[];
			/** Every stage completes at once because the requester is their own approver. */
			autoCompleted: boolean;
			notes: ApprovalRouteNote[];
	  }
	| { kind: "unroutable"; reason: ApprovalRouteUnroutableReason };

/** What a variant of a request (an absence category, an expense amount) was previewed with. */
export interface ApprovalRouteVariant {
	absenceCategoryId?: string;
	travelExpenseAmount?: number;
}

/**
 * The approval route of one kind for one requester. Unroutable when any variant is; skipped when
 * the request path writes no request at all (no variants); routed otherwise, auto-completed when
 * every variant auto-completes.
 */
export type ApprovalRoute = (
	| { kind: "routed"; autoCompleted: boolean }
	| { kind: "skipped"; reason: ApprovalRouteSkipReason }
	| { kind: "unroutable"; reason: ApprovalRouteUnroutableReason }
) & {
	notes: ApprovalRouteNote[];
	variants: Array<{ variant: ApprovalRouteVariant; outcome: ApprovalRouteOutcome }>;
};

export interface ApprovalRoutePreview {
	/** The kinds previewed, in display order: switched-off kinds are left out. */
	kinds: readonly ApprovalRouteKind[];
	/** Kinds switched off for the organization (no cadence, shifts off), so not previewed. */
	offKinds: readonly ApprovalRouteKind[];
	/** By {@link approvalRouteRequesterKey}, then by kind. */
	routes: Map<string, Map<ApprovalRouteKind, ApprovalRoute>>;
}
