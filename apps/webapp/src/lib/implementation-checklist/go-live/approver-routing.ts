import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { member, organization } from "@/db/auth-schema";
import {
	absenceCategory,
	approvalPolicy,
	changePolicy,
	changePolicyAssignment,
	employee,
	employeeGroup,
	employeeGroupMember,
	employeeManagers,
	team,
	teamMembership,
	travelExpenseSettings,
} from "@/db/schema";
import {
	readApprovalAuthoritySnapshots,
	readApprovalWriteGateOpenSnapshot,
} from "@/lib/approvals/authority";
import { periodSubmissionRoutingContext } from "@/lib/approvals/domain-adapters/period-submission.adapter";
import { PERIOD_SUBMISSION_SOURCE_TYPE } from "@/lib/approvals/domain-adapters/period-submission-contract";
import { resolveApproverFromDirectory } from "@/lib/approvals/policies/approver-resolution";
import { type DbPolicyRecord, policyFromDbRecord } from "@/lib/approvals/policies/chain-service";
import type {
	EligibleManagerEmployee,
	EligibleManagerLink,
	EligibleTeam,
	EligibleTeamMembership,
} from "@/lib/approvals/policies/manager-eligibility";
import { resolvePrimaryEligibleManager } from "@/lib/approvals/policies/manager-eligibility";
import { findMatchingPolicy } from "@/lib/approvals/policies/matcher";
import { classifyLegacyStage } from "@/lib/approvals/policies/requester-auto-approval";
import type {
	ApprovalPolicyDraft,
	ApprovalPolicyEvaluationContext,
} from "@/lib/approvals/policies/types";
import type { ApprovalStageReviewerDirectory } from "@/lib/approvals/routing/approver-resolver";
import {
	ApprovalRoutingPolicyValidationError,
	findMatchingRoutingPolicy,
} from "@/lib/approvals/routing/policy-matcher";
import {
	createDatabaseStageActivationResolver,
	loadApprovalStageDirectory,
} from "@/lib/approvals/routing/stage-activation-resolver";
import type { ApprovalRoutingContext } from "@/lib/approvals/routing/types";
import type { ApprovalWorkflowSnapshot, JsonObject } from "@/lib/approvals/workflow/ports";
import { normalizeStableData } from "@/lib/approvals/workflow/stable-data";
import {
	ApprovalWorkflowStartError,
	loadApprovalWorkflowStartPolicies,
	planApprovalWorkflowStart,
} from "@/lib/approvals/workflow/start-workflow";
import type { ApprovalWorkflowType } from "@/lib/approvals/workflow/types";
import { hasOrganizationRole } from "@/lib/auth/organization-role";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import { loadCollectsPeriodSubmissions } from "@/lib/time-tracking/period-submissions/settings";
import { resolveReportReviewer } from "@/lib/travel-expenses/report-reviewer-routing";
import type { GoLiveAsOf, GoLiveMember } from "./types";

/**
 * How each covered approval kind would route one go-live group member (#1514), worked out
 * read-only as submitting would: canonical kinds plan the workflow start (the dry run period
 * submission readiness uses), legacy kinds apply the read half of legacy policy resolution, and
 * built-in skips come from the same rules the request paths apply. Nothing starts a workflow or
 * writes a row; run it inside a read-only transaction. The go-live rehearsal (#1517) reuses it.
 *
 * Organization-wide inputs load once; each member is then resolved in memory, except a policy
 * naming a departed approver, whose replacement is read for that requester as a start reads it.
 */

/** The approval kinds the approver go-live check covers, in display order. */
export const APPROVER_GO_LIVE_KINDS = [
	"absence",
	"time_correction",
	"manual_time_submission",
	"period_submission",
	"travel_expense",
	"shift_request",
] as const satisfies readonly ApprovalWorkflowType[];

export type ApproverGoLiveKind = (typeof APPROVER_GO_LIVE_KINDS)[number];

/** A pass that needs no approver, as the request path itself decides. */
export type ApproverSkipReason =
	/** Time corrections and work-period submissions: no change policy applies. */
	| "change_policy_no_policy"
	/** The change policy is in trust mode. */
	| "change_policy_trust_mode"
	/** Every change the policy allows is within its self-service days. */
	| "change_policy_within_self_service"
	/** Owners and admins record their own manual work directly. */
	| "owner_admin_self"
	/** No active absence category requires approval. */
	| "no_category_requires_approval"
	/** The requester resolves as their own approver, and the request completes. */
	| "requester_is_approver"
	/** The owner approves their own expense report when nobody else can (#679). */
	| "owner_self_approval";

/** Why a member's request of a kind would not get an approver. */
export type ApproverUnroutableCause =
	/** No policy matches and the member has no eligible manager to default to. */
	| { code: "no_default_approver" }
	/** The member's manager has left and nobody stands in for them. */
	| { code: "default_approver_departed" }
	/** The matching policy has a stage nobody eligible resolves to. */
	| { code: "policy_unresolvable"; policyId: string; policyName: string }
	/** The organization's approval policies can't be read as a request would read them. */
	| { code: "invalid_policies" }
	/** Expense reports would route to the employee themselves, which submitting refuses. */
	| { code: "self_approval_route" }
	/** The kind can't be submitted in the organization's approval mode (support only). */
	| { code: "approval_mode_unsupported" }
	/** Nobody may decide shift requests. */
	| { code: "no_decider" }
	/** More than one change policy applies at one level, so manual work is refused. */
	| { code: "change_policy_ambiguous" };

/** One stage of a would-be route. Later canonical stages activate only once earlier ones decide. */
export interface ApproverRouteStage {
	sequence: number;
	label: string | null;
	approverType: string;
	fallbackBehavior: string | null;
	approverEmployeeIds: string[];
	activation: "human" | "requester_auto_approve" | "not_activated";
}

export interface ApproverRoute {
	path: "canonical" | "legacy" | "shift_deciders";
	/** The matched approval policy, or null for the default approver. */
	policy: { id: string; name: string } | null;
	defaultApproverEmployeeId: string | null;
	stages: ApproverRouteStage[];
}

/** What a variant of a request (an absence category, an expense amount) was checked with. */
export interface ApproverVariant {
	absenceCategoryId?: string;
	travelExpenseAmount?: number;
}

export type ApproverVariantResult =
	| { status: "routed"; route: ApproverRoute }
	| { status: "skipped"; reason: ApproverSkipReason; route: ApproverRoute }
	| { status: "unroutable"; cause: ApproverUnroutableCause };

/**
 * One kind for one member. Unroutable when any variant is; skipped when the kind needs no
 * approver at all or every variant skips; routed otherwise.
 */
export type ApproverKindResolution =
	| {
			status: "routed";
			variants: Array<{ variant: ApproverVariant; result: ApproverVariantResult }>;
	  }
	| {
			status: "skipped";
			reason: ApproverSkipReason;
			variants: Array<{ variant: ApproverVariant; result: ApproverVariantResult }>;
	  }
	| {
			status: "unroutable";
			cause: ApproverUnroutableCause;
			variants: Array<{ variant: ApproverVariant; result: ApproverVariantResult }>;
	  };

export interface ApproverRouting {
	/** The kinds checked, in display order: switched-off kinds are left out. */
	kinds: readonly ApproverGoLiveKind[];
	/** Kinds switched off for the organization, so not checked. */
	offKinds: readonly ApproverGoLiveKind[];
	/** Every checked kind for one member of the group the routing was loaded for. */
	resolve(member: GoLiveMember): Promise<Map<ApproverGoLiveKind, ApproverKindResolution>>;
}

/** Stands in for the source row a real start binds; nothing is written under it. */
const DRY_RUN_SOURCE_ID = "00000000-0000-4000-8000-000000000000";

const CANONICAL_SOURCE_TYPE: Record<
	Exclude<ApproverGoLiveKind, "travel_expense" | "shift_request">,
	string
> = {
	absence: "absence_entry",
	time_correction: "time_entry",
	manual_time_submission: "time_entry",
	period_submission: PERIOD_SUBMISSION_SOURCE_TYPE,
};

type Requester = {
	id: string;
	teamId: string | null;
	userId: string | null;
	invitee: boolean;
};

type ChangePolicyRow = {
	assignmentId: string;
	level: "organization" | "team" | "employee";
	employeeId: string | null;
	teamId: string | null;
	assignmentActive: boolean;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	createdAt: Date;
	policyActive: boolean;
	selfServiceDays: number;
	approvalDays: number;
	noApprovalRequired: boolean;
};

type ChangePolicyFacts = Pick<
	ChangePolicyRow,
	"selfServiceDays" | "approvalDays" | "noApprovalRequired"
>;

/**
 * Loads what routing the given members reads, once for the organization. `db` must be a
 * read-only transaction: a member is resolved later through it.
 */
export async function loadApproverRouting(
	db: DatabaseClient,
	input: { organizationId: string; asOf: GoLiveAsOf; members: readonly GoLiveMember[] },
): Promise<ApproverRouting> {
	const { organizationId, asOf } = input;
	const at = new Date(asOf.instant.epochMilliseconds);
	const [
		authority,
		canonicalBase,
		legacyEmployees,
		managerLinks,
		memberships,
		teams,
		legacyPolicyRecords,
		groupMembers,
		changePolicyRows,
		requiringCategories,
		expenseSettings,
		memberRoles,
		collectsPeriods,
		organizationRow,
		deciderRows,
		periodSubmissionGateOpen,
	] = await inOrder([
		() =>
			readApprovalAuthoritySnapshots(db as never, organizationId, [
				"absence",
				"time_correction",
				"manual_time_submission",
				"travel_expense",
			] as const),
		() => loadApprovalStageDirectory(db, { organizationId, namedApproverId: null }),
		// Legacy routing reads the stored activity flag, as `getPrimaryEligibleManagerIdForRequester` does.
		() => db.query.employee.findMany({ where: eq(employee.organizationId, organizationId) }),
		() =>
			db
				.select({
					employeeId: employeeManagers.employeeId,
					managerId: employeeManagers.managerId,
					isPrimary: employeeManagers.isPrimary,
				})
				.from(employeeManagers)
				.innerJoin(employee, eq(employee.id, employeeManagers.employeeId))
				.where(eq(employee.organizationId, organizationId)),
		() =>
			db
				.select({ employeeId: teamMembership.employeeId, teamId: teamMembership.teamId })
				.from(teamMembership)
				.where(eq(teamMembership.organizationId, organizationId)),
		() =>
			db
				.select({
					id: team.id,
					organizationId: team.organizationId,
					primaryManagerId: team.primaryManagerId,
				})
				.from(team)
				.where(eq(team.organizationId, organizationId)),
		() =>
			db.query.approvalPolicy.findMany({
				where: eq(approvalPolicy.organizationId, organizationId),
				orderBy: [asc(approvalPolicy.priority)],
				with: { conditions: true, stages: true },
			}),
		() =>
			db
				.select({
					employeeId: employeeGroupMember.employeeId,
					groupId: employeeGroupMember.groupId,
				})
				.from(employeeGroupMember)
				.innerJoin(
					employeeGroup,
					and(
						eq(employeeGroup.id, employeeGroupMember.groupId),
						eq(employeeGroup.organizationId, organizationId),
						eq(employeeGroup.isActive, true),
					),
				)
				.where(eq(employeeGroupMember.organizationId, organizationId)),
		() =>
			db
				.select({
					assignmentId: changePolicyAssignment.id,
					level: changePolicyAssignment.assignmentType,
					employeeId: changePolicyAssignment.employeeId,
					teamId: changePolicyAssignment.teamId,
					assignmentActive: changePolicyAssignment.isActive,
					effectiveFrom: changePolicyAssignment.effectiveFrom,
					effectiveUntil: changePolicyAssignment.effectiveUntil,
					createdAt: changePolicyAssignment.createdAt,
					policyActive: changePolicy.isActive,
					selfServiceDays: changePolicy.selfServiceDays,
					approvalDays: changePolicy.approvalDays,
					noApprovalRequired: changePolicy.noApprovalRequired,
				})
				.from(changePolicyAssignment)
				.innerJoin(
					changePolicy,
					and(
						eq(changePolicy.id, changePolicyAssignment.policyId),
						eq(changePolicy.organizationId, organizationId),
					),
				)
				.where(eq(changePolicyAssignment.organizationId, organizationId))
				.orderBy(asc(changePolicyAssignment.createdAt), asc(changePolicyAssignment.id)),
		() =>
			db
				.select({ id: absenceCategory.id })
				.from(absenceCategory)
				.where(
					and(
						eq(absenceCategory.organizationId, organizationId),
						eq(absenceCategory.isActive, true),
						eq(absenceCategory.requiresApproval, true),
					),
				)
				.orderBy(asc(absenceCategory.id)),
		() =>
			db
				.select({ expenseApproverEmployeeId: travelExpenseSettings.expenseApproverEmployeeId })
				.from(travelExpenseSettings)
				.where(eq(travelExpenseSettings.organizationId, organizationId))
				.limit(1),
		() =>
			db
				.select({ userId: member.userId, role: member.role })
				.from(member)
				.where(and(eq(member.organizationId, organizationId), eq(member.status, "approved"))),
		() =>
			loadCollectsPeriodSubmissions(db as never, organizationId, {
				clock: { nowInstant: () => asOf.instant },
			}),
		() =>
			db
				.select({ shiftsEnabled: organization.shiftsEnabled })
				.from(organization)
				.where(eq(organization.id, organizationId))
				.limit(1),
		// Shift requests are decided by any manager or admin on the current roster.
		() =>
			db
				.select({ id: employee.id })
				.from(employee)
				.where(
					and(
						onCurrentRoster(organizationId, employee, asOf.instant),
						inArray(employee.role, ["manager", "admin"]),
					),
				),
		() =>
			readApprovalWriteGateOpenSnapshot(db as never, {
				organizationId,
				workflowType: "period_submission",
			}),
	]);

	const offKinds: ApproverGoLiveKind[] = [];
	if (!collectsPeriods) offKinds.push("period_submission");
	if (!organizationRow[0]?.shiftsEnabled) offKinds.push("shift_request");
	const kinds = APPROVER_GO_LIVE_KINDS.filter((kind) => !offKinds.includes(kind));

	const canonicalKinds = (["absence", "time_correction", "manual_time_submission"] as const).filter(
		(kind) => authority.get(kind)?.authority === "canonical",
	);
	const canonicalPolicyKinds = [
		...canonicalKinds,
		...(kinds.includes("period_submission") ? (["period_submission"] as const) : []),
	];
	const canonicalPolicies = new Map<ApprovalWorkflowType, ApprovalPolicyDraft[] | "invalid">(
		await mapInOrder(canonicalPolicyKinds, async (kind) => {
			try {
				const policies = await loadApprovalWorkflowStartPolicies(db, {
					organizationId,
					workflowType: kind,
				});
				return [kind, policies] as const;
			} catch (error) {
				if (error instanceof ApprovalWorkflowStartError && error.code === "INVALID_POLICY") {
					return [kind, "invalid"] as const;
				}
				throw error;
			}
		}),
	);

	// Invitees resolve as an employee of their draft team would: no manager links of their own.
	const invitees = new Map<string, Requester>();
	for (const groupMember of input.members) {
		if (groupMember.kind !== "invitee") continue;
		invitees.set(groupMember.draftId, {
			id: randomUUID(),
			teamId: groupMember.teamId,
			userId: null,
			invitee: true,
		});
	}
	const syntheticEmployees: EligibleManagerEmployee[] = [...invitees.values()].map((invitee) => ({
		id: invitee.id,
		organizationId,
		isActive: true,
		role: "employee",
		teamId: invitee.teamId,
	}));
	const syntheticMemberships: EligibleTeamMembership[] = [...invitees.values()].flatMap(
		(invitee) => (invitee.teamId ? [{ employeeId: invitee.id, teamId: invitee.teamId }] : []),
	);
	const withInvitees = (
		directory: ApprovalStageReviewerDirectory,
	): ApprovalStageReviewerDirectory => ({
		...directory,
		employees: [...directory.employees, ...syntheticEmployees],
		teamMemberships: [...directory.teamMemberships, ...syntheticMemberships],
	});
	const canonicalDirectory = withInvitees(canonicalBase);

	const legacyDirectory = {
		employees: [
			...legacyEmployees.map((row) => ({
				id: row.id,
				organizationId: row.organizationId,
				isActive: row.isActive,
				role: row.role,
				teamId: row.teamId,
			})),
			...syntheticEmployees,
		] satisfies EligibleManagerEmployee[],
		managerLinks: managerLinks satisfies EligibleManagerLink[],
		teamMemberships: [...memberships, ...syntheticMemberships] satisfies EligibleTeamMembership[],
		teams: teams satisfies EligibleTeam[],
	};
	const userIdByEmployee = new Map(legacyEmployees.map((row) => [row.id, row.userId]));
	const rolesByUser = new Map(memberRoles.map((row) => [row.userId, row.role]));
	const legacyPolicies = (legacyPolicyRecords as unknown as DbPolicyRecord[]).map(
		policyFromDbRecord,
	);
	const groupIdsByEmployee = Map.groupBy(groupMembers, (row) => row.employeeId);
	const expenseApproverEmployeeId = expenseSettings[0]?.expenseApproverEmployeeId ?? null;
	const deciderIds = deciderRows.map((row) => row.id);
	const activeCanonicalIds = new Set(
		canonicalBase.employees.filter((row) => row.isActive).map((row) => row.id),
	);

	// The directory a stage resolves from, read once; only a departed named approver's
	// replacement is read per requester, exactly as a start reads it.
	const activationResolver = createDatabaseStageActivationResolver({
		loadDirectory: async (executor, args) => {
			if (args.namedApproverId === null || activeCanonicalIds.has(args.namedApproverId)) {
				return canonicalDirectory;
			}
			return withInvitees(await loadApprovalStageDirectory(executor, args));
		},
	});

	const activePolicies = legacyPolicies.filter((policy) => policy.isActive);
	const absenceVariants = absenceCategoryVariants(
		requiringCategories.map((row) => row.id),
		activePolicies,
	);
	const expenseAmounts = expenseAmountVariants(activePolicies);

	function defaultApproverOf(requester: Requester): string | null {
		const result = resolvePrimaryEligibleManager({
			organizationId,
			requesterEmployeeId: requester.id,
			...legacyDirectory,
		});
		return result.ok ? result.managerId : null;
	}

	async function planCanonical(
		kind: keyof typeof CANONICAL_SOURCE_TYPE,
		requester: Requester,
		defaultApproverEmployeeId: string | null,
		routingContext: ApprovalRoutingContext,
	): Promise<ApproverVariantResult> {
		const policies = canonicalPolicies.get(kind);
		if (!policies || policies === "invalid")
			return { status: "unroutable", cause: { code: "invalid_policies" } };
		let matched: ApprovalPolicyDraft | null;
		try {
			matched = findMatchingRoutingPolicy(routingContext, policies);
		} catch (error) {
			if (error instanceof ApprovalRoutingPolicyValidationError) {
				return { status: "unroutable", cause: { code: "invalid_policies" } };
			}
			throw error;
		}
		try {
			const planned = await planApprovalWorkflowStart({
				context: { dbService: { db: db as never }, activationResolver },
				organizationId,
				workflowType: kind,
				sourceIdentity: {
					organizationId,
					workflowType: kind,
					sourceType: CANONICAL_SOURCE_TYPE[kind],
					sourceId: DRY_RUN_SOURCE_ID,
				},
				requesterEmployeeId: requester.id,
				submissionKey: `go-live-check:${kind}:${requester.id}`,
				defaultApproverEmployeeId,
				routingContext,
				contextSnapshot: normalizeStableData(routingContext) as JsonObject,
				displaySnapshot: {},
				now: asOf.instant,
				policies,
			});
			const route = canonicalRoute(planned.snapshot, matched, defaultApproverEmployeeId);
			if (planned.snapshot.status === "approved") {
				return { status: "skipped", reason: "requester_is_approver", route };
			}
			if (planned.snapshot.status !== "pending") {
				throw new Error(`Approval workflow would not start pending: ${planned.snapshot.status}`);
			}
			return { status: "routed", route };
		} catch (error) {
			if (!(error instanceof ApprovalWorkflowStartError)) throw error;
			// A resolver that failed has not found nobody: the lookup fails (#1302 review).
			if (
				error.code === "ACTIVATION_FAILED" &&
				error.details.activationCode === "resolver_failure"
			) {
				throw error;
			}
			if (error.code === "INVALID_POLICY")
				return { status: "unroutable", cause: { code: "invalid_policies" } };
			if (error.code === "NO_DEFAULT_APPROVER") {
				return { status: "unroutable", cause: { code: "no_default_approver" } };
			}
			if (error.code === "ACTIVATION_FAILED" || error.code === "ACTIVATION_LIMIT") {
				if (matched) {
					return {
						status: "unroutable",
						cause: { code: "policy_unresolvable", policyId: matched.id, policyName: matched.name },
					};
				}
				return {
					status: "unroutable",
					cause:
						defaultApproverEmployeeId && !activeCanonicalIds.has(defaultApproverEmployeeId)
							? { code: "default_approver_departed" }
							: { code: "no_default_approver" },
				};
			}
			throw error;
		}
	}

	type LegacyResult =
		| { kind: "failed"; field: "managerId" }
		| { kind: "failed"; field: "stage"; policy: ApprovalPolicyDraft }
		| { kind: "invalid_policies" }
		| { kind: "resolved"; autoCompleted: boolean; route: ApproverRoute };

	/** The read half of `resolvePolicyAndCreateApproval`: what it would create, or why it fails. */
	function resolveLegacy(
		requester: Requester,
		context: Omit<
			ApprovalPolicyEvaluationContext,
			"organizationId" | "requesterEmployeeId" | "employeeGroupIds" | "entityId"
		>,
		defaultApproverId: string | null,
	): LegacyResult {
		const evaluation: ApprovalPolicyEvaluationContext = {
			...context,
			organizationId,
			requesterEmployeeId: requester.id,
			employeeGroupIds: (groupIdsByEmployee.get(requester.id) ?? []).map((row) => row.groupId),
			entityId: DRY_RUN_SOURCE_ID,
		};
		let matched: ApprovalPolicyDraft | null;
		try {
			matched = findMatchingPolicy(evaluation, legacyPolicies);
		} catch (error) {
			if (error instanceof ApprovalRoutingPolicyValidationError)
				return { kind: "invalid_policies" };
			throw error;
		}
		if (!matched) {
			if (!defaultApproverId) return { kind: "failed", field: "managerId" };
			const disposition = classifyLegacyStage({
				requesterEmployeeId: requester.id,
				approverEmployeeId: defaultApproverId,
			});
			return {
				kind: "resolved",
				autoCompleted: disposition.kind === "auto_approve",
				route: legacyDefaultRoute(defaultApproverId, disposition.kind === "auto_approve"),
			};
		}
		const stages: ApproverRouteStage[] = [];
		for (const stage of matched.stages.toSorted(
			(left, right) => left.stepOrder - right.stepOrder,
		)) {
			const resolved = resolveApproverFromDirectory({
				organizationId,
				requesterEmployeeId: requester.id,
				stage,
				...legacyDirectory,
			});
			if (!resolved.ok) return { kind: "failed", field: "stage", policy: matched };
			stages.push({
				sequence: stage.stepOrder,
				label: stage.label,
				approverType: stage.approverType,
				fallbackBehavior: null,
				approverEmployeeIds: [resolved.approverEmployeeId],
				activation:
					resolved.approverEmployeeId === requester.id ? "requester_auto_approve" : "human",
			});
		}
		if (stages.length === 0) return { kind: "failed", field: "stage", policy: matched };
		return {
			kind: "resolved",
			autoCompleted: stages.every((stage) => stage.activation === "requester_auto_approve"),
			route: {
				path: "legacy",
				policy: { id: matched.id, name: matched.name },
				defaultApproverEmployeeId: defaultApproverId,
				stages,
			},
		};
	}

	function legacyOutcome(result: LegacyResult): ApproverVariantResult {
		switch (result.kind) {
			case "invalid_policies":
				return { status: "unroutable", cause: { code: "invalid_policies" } };
			case "failed":
				return result.field === "managerId"
					? { status: "unroutable", cause: { code: "no_default_approver" } }
					: {
							status: "unroutable",
							cause: {
								code: "policy_unresolvable",
								policyId: result.policy.id,
								policyName: result.policy.name,
							},
						};
			case "resolved":
				return result.autoCompleted
					? { status: "skipped", reason: "requester_is_approver", route: result.route }
					: { status: "routed", route: result.route };
		}
	}

	function canonicalContext(
		kind: ApprovalWorkflowType,
		sourceType: string,
		requester: Requester,
		overrides: Partial<ApprovalRoutingContext>,
	): ApprovalRoutingContext {
		return {
			organizationId,
			workflowType: kind,
			source: { type: sourceType, id: DRY_RUN_SOURCE_ID },
			requesterEmployeeId: requester.id,
			teamIds: requester.teamId ? [requester.teamId] : [],
			locationId: null,
			absenceCategoryId: null,
			travelExpenseAmount: null,
			overtimeRisk: null,
			employeeGroupIds: [],
			...overrides,
		};
	}

	async function resolveAbsence(requester: Requester): Promise<ApproverKindResolution> {
		if (absenceVariants.length === 0) {
			return { status: "skipped", reason: "no_category_requires_approval", variants: [] };
		}
		const defaultApproverId = defaultApproverOf(requester);
		const canonical = authority.get("absence")?.authority === "canonical";
		return combine(
			await mapInOrder(absenceVariants, async (absenceCategoryId) => {
				const variant = { absenceCategoryId };
				if (canonical) {
					return {
						variant,
						result: await planCanonical(
							"absence",
							requester,
							defaultApproverId,
							canonicalContext("absence", "absence_entry", requester, { absenceCategoryId }),
						),
					};
				}
				const legacy = resolveLegacy(
					requester,
					{
						approvalType: "absence_entry",
						teamId: requester.teamId,
						locationId: null,
						absenceCategoryId,
						travelExpenseAmount: null,
						overtimeRisk: null,
						entityType: "absence_entry",
					},
					defaultApproverId,
				);
				// Absences fall back to the default approver whenever policy routing fails.
				if (legacy.kind === "failed") {
					if (!defaultApproverId) {
						return {
							variant,
							result: { status: "unroutable", cause: { code: "no_default_approver" } },
						};
					}
					const self = defaultApproverId === requester.id;
					const route = legacyDefaultRoute(defaultApproverId, self);
					return {
						variant,
						result: self
							? { status: "skipped", reason: "requester_is_approver", route }
							: { status: "routed", route },
					};
				}
				return { variant, result: legacyOutcome(legacy) };
			}),
		);
	}

	async function resolveTimeKind(
		kind: "time_correction" | "manual_time_submission",
		requester: Requester,
	): Promise<ApproverKindResolution> {
		if (kind === "manual_time_submission" && !requester.invitee && requester.userId) {
			const role = rolesByUser.get(requester.userId);
			if (hasOrganizationRole(role, "owner") || hasOrganizationRole(role, "admin")) {
				return { status: "skipped", reason: "owner_admin_self", variants: [] };
			}
		}
		const policy =
			kind === "time_correction"
				? correctionChangePolicy(changePolicyRows, requester, at)
				: manualChangePolicy(changePolicyRows, requester, at);
		if (policy === "ambiguous") {
			return { status: "unroutable", cause: { code: "change_policy_ambiguous" }, variants: [] };
		}
		if (!policy) return { status: "skipped", reason: "change_policy_no_policy", variants: [] };
		if (policy.noApprovalRequired) {
			return { status: "skipped", reason: "change_policy_trust_mode", variants: [] };
		}
		// Beyond the window a correction is refused, so with no approval days none needs approval.
		// Manual work beyond the window still goes to approval.
		if (kind === "time_correction" && policy.approvalDays === 0) {
			return { status: "skipped", reason: "change_policy_within_self_service", variants: [] };
		}
		const overtimeRisk = kind === "manual_time_submission" ? ("none" as const) : null;
		const defaultApproverId = defaultApproverOf(requester);
		const variant = {};
		if (authority.get(kind)?.authority === "canonical") {
			return combine([
				{
					variant,
					result: await planCanonical(
						kind,
						requester,
						defaultApproverId,
						canonicalContext(kind, "time_entry", requester, { overtimeRisk }),
					),
				},
			]);
		}
		return combine([
			{
				variant,
				result: legacyOutcome(
					resolveLegacy(
						requester,
						{
							approvalType: "time_entry",
							teamId: requester.teamId,
							locationId: null,
							absenceCategoryId: null,
							travelExpenseAmount: null,
							overtimeRisk,
							entityType: "time_entry",
						},
						defaultApproverId,
					),
				),
			},
		]);
	}

	async function resolvePeriodSubmission(requester: Requester): Promise<ApproverKindResolution> {
		// A canonical-only kind: the write gate opens only in complete mode.
		if (!periodSubmissionGateOpen) {
			return { status: "unroutable", cause: { code: "approval_mode_unsupported" }, variants: [] };
		}
		const routingContext = periodSubmissionRoutingContext({
			organizationId,
			submissionId: DRY_RUN_SOURCE_ID,
			requesterEmployeeId: requester.id,
			teamIds: requester.teamId ? [requester.teamId] : [],
		});
		return combine([
			{
				variant: {},
				result: await planCanonical(
					"period_submission",
					requester,
					defaultApproverOf(requester),
					routingContext,
				),
			},
		]);
	}

	function resolveExpenseReport(requester: Requester): ApproverKindResolution {
		// Submitting refuses outside legacy authority: nobody can submit a report.
		if (authority.get("travel_expense")?.authority !== "legacy") {
			return { status: "unroutable", cause: { code: "approval_mode_unsupported" }, variants: [] };
		}
		const reviewer = resolveReportReviewer({
			organizationId,
			requesterEmployeeId: requester.id,
			...legacyDirectory,
			expenseApproverEmployeeId,
			requesterIsOrganizationOwner:
				!requester.invitee &&
				requester.userId !== null &&
				hasOrganizationRole(rolesByUser.get(requester.userId), "owner"),
		});
		if (!reviewer.ok && reviewer.reason === "requester_inactive") {
			return { status: "unroutable", cause: { code: "no_default_approver" }, variants: [] };
		}
		const ownerAlone = reviewer.ok && reviewer.source === "owner_self_approval";
		return combine(
			expenseAmounts.map((travelExpenseAmount) => {
				const variant = { travelExpenseAmount };
				const legacy = resolveLegacy(
					requester,
					{
						approvalType: "travel_expense_report",
						teamId: requester.teamId,
						locationId: null,
						absenceCategoryId: null,
						travelExpenseAmount,
						overtimeRisk: null,
						entityType: "travel_expense_report",
					},
					reviewer.ok ? reviewer.reviewerId : null,
				);
				if (legacy.kind !== "resolved") return { variant, result: legacyOutcome(legacy) };
				if (legacy.autoCompleted) {
					return {
						variant,
						result: ownerAlone
							? { status: "skipped", reason: "owner_self_approval", route: legacy.route }
							: { status: "unroutable", cause: { code: "self_approval_route" } },
					};
				}
				// A stage the requester would approve themselves is refused at submit.
				if (legacy.route.stages.some((stage) => stage.approverEmployeeIds.includes(requester.id))) {
					return {
						variant,
						result: { status: "unroutable", cause: { code: "self_approval_route" } },
					};
				}
				return { variant, result: { status: "routed", route: legacy.route } };
			}),
		);
	}

	function resolveShiftRequest(requester: Requester): ApproverKindResolution {
		const others = deciderIds.filter((id) => id !== requester.id);
		const route: ApproverRoute = {
			path: "shift_deciders",
			policy: null,
			defaultApproverEmployeeId: null,
			stages: [
				{
					sequence: 1,
					label: null,
					approverType: "manager_or_admin",
					fallbackBehavior: null,
					approverEmployeeIds: others.length > 0 ? others : deciderIds,
					activation: others.length > 0 ? "human" : "requester_auto_approve",
				},
			],
		};
		if (others.length > 0) return combine([{ variant: {}, result: { status: "routed", route } }]);
		if (deciderIds.length > 0) {
			return combine([
				{ variant: {}, result: { status: "skipped", reason: "requester_is_approver", route } },
			]);
		}
		return { status: "unroutable", cause: { code: "no_decider" }, variants: [] };
	}

	return {
		kinds,
		offKinds,
		async resolve(groupMember) {
			const requester: Requester =
				groupMember.kind === "employee"
					? {
							id: groupMember.employeeId,
							teamId: groupMember.primaryTeamId,
							userId: userIdByEmployee.get(groupMember.employeeId) ?? null,
							invitee: false,
						}
					: (invitees.get(groupMember.draftId) ?? failMissingInvitee(groupMember.draftId));
			const resolutions = new Map<ApproverGoLiveKind, ApproverKindResolution>();
			for (const kind of kinds) {
				switch (kind) {
					case "absence":
						resolutions.set(kind, await resolveAbsence(requester));
						break;
					case "time_correction":
					case "manual_time_submission":
						resolutions.set(kind, await resolveTimeKind(kind, requester));
						break;
					case "period_submission":
						resolutions.set(kind, await resolvePeriodSubmission(requester));
						break;
					case "travel_expense":
						resolutions.set(kind, resolveExpenseReport(requester));
						break;
					case "shift_request":
						resolutions.set(kind, resolveShiftRequest(requester));
						break;
				}
			}
			return resolutions;
		},
	};
}

function failMissingInvitee(draftId: string): never {
	throw new Error(`Invitee ${draftId} is not in the group the approver routing was loaded for`);
}

/** Runs reads one after another: a transaction's connection runs one query at a time. */
async function inOrder<const T extends readonly (() => PromiseLike<unknown>)[]>(
	reads: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
	const results: unknown[] = [];
	for (const read of reads) results.push(await read());
	return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

/** Sequential, so every read stays in order on the one read-only transaction. */
async function mapInOrder<T, R>(items: readonly T[], fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = [];
	for (const item of items) results.push(await fn(item));
	return results;
}

function combine(
	variants: Array<{ variant: ApproverVariant; result: ApproverVariantResult }>,
): ApproverKindResolution {
	for (const { result } of variants) {
		if (result.status === "unroutable")
			return { status: "unroutable", cause: result.cause, variants };
	}
	const skips = variants.flatMap(({ result }) =>
		result.status === "skipped" ? [result.reason] : [],
	);
	const [firstSkip] = skips;
	if (firstSkip && skips.length === variants.length) {
		return { status: "skipped", reason: firstSkip, variants };
	}
	return { status: "routed", variants };
}

function legacyDefaultRoute(approverEmployeeId: string, self: boolean): ApproverRoute {
	return {
		path: "legacy",
		policy: null,
		defaultApproverEmployeeId: approverEmployeeId,
		stages: [
			{
				sequence: 1,
				label: null,
				approverType: "default_approver",
				fallbackBehavior: null,
				approverEmployeeIds: [approverEmployeeId],
				activation: self ? "requester_auto_approve" : "human",
			},
		],
	};
}

function canonicalRoute(
	snapshot: ApprovalWorkflowSnapshot,
	matched: ApprovalPolicyDraft | null,
	defaultApproverEmployeeId: string | null,
): ApproverRoute {
	return {
		path: "canonical",
		policy: matched ? { id: matched.id, name: matched.name } : null,
		defaultApproverEmployeeId,
		stages: snapshot.stages.map((stage) => ({
			sequence: stage.sequence,
			label: stage.label || null,
			approverType: String(stage.resolverSnapshot.approverType ?? ""),
			fallbackBehavior:
				typeof stage.resolverSnapshot.fallbackBehavior === "string"
					? stage.resolverSnapshot.fallbackBehavior
					: null,
			approverEmployeeIds: stage.assignments.map((assignment) => assignment.approverEmployeeId),
			activation:
				stage.status === "waiting"
					? "not_activated"
					: stage.activationMode === "requester_auto_approve"
						? "requester_auto_approve"
						: "human",
		})),
	};
}

/**
 * The absence categories worth checking: each category a policy condition names, and one other
 * (they all route alike). Empty when no active category requires approval.
 */
function absenceCategoryVariants(
	categoryIds: readonly string[],
	policies: readonly ApprovalPolicyDraft[],
): string[] {
	const named = new Set(
		policies.flatMap((policy) =>
			policy.conditions.flatMap((condition) =>
				condition.conditionType === "absence_category"
					? [condition.value, ...(condition.values ?? [])].filter(
							(value): value is string => typeof value === "string",
						)
					: [],
			),
		),
	);
	const checked = categoryIds.filter((id) => named.has(id));
	const other = categoryIds.find((id) => !named.has(id));
	return other ? [...checked, other] : checked;
}

/**
 * Report totals worth checking: zero, every amount threshold of an active policy, a value between
 * neighbouring thresholds and one above the highest, so each amount band is routed once.
 */
function expenseAmountVariants(policies: readonly ApprovalPolicyDraft[]): number[] {
	const thresholds = [
		...new Set(
			policies.flatMap((policy) =>
				policy.conditions.flatMap((condition) =>
					condition.conditionType === "travel_expense_amount"
						? [condition.amountMin, condition.amountMax].filter(
								(value): value is number => typeof value === "number" && value > 0,
							)
						: [],
				),
			),
		),
	].toSorted((left, right) => left - right);
	const amounts = [0];
	for (const [index, threshold] of thresholds.entries()) {
		const previous = index === 0 ? 0 : (thresholds[index - 1] ?? 0);
		amounts.push((previous + threshold) / 2, threshold);
	}
	const highest = thresholds.at(-1);
	if (highest !== undefined) amounts.push(highest + 1);
	return [...new Set(amounts)];
}

function matchesLevel(row: ChangePolicyRow, level: ChangePolicyRow["level"], requester: Requester) {
	if (row.level !== level) return false;
	if (level === "employee") return !requester.invitee && row.employeeId === requester.id;
	if (level === "team") return requester.teamId !== null && row.teamId === requester.teamId;
	return true;
}

const CHANGE_POLICY_LEVELS = ["employee", "team", "organization"] as const;

/**
 * The change policy a time correction applies (`ChangePolicyService.resolvePolicy`): employee,
 * then primary team, then organization; at each level the first active assignment counts if its
 * policy is active. That resolver matches only assignments with no end date.
 */
function correctionChangePolicy(
	rows: readonly ChangePolicyRow[],
	requester: Requester,
	at: Date,
): ChangePolicyFacts | null {
	for (const level of CHANGE_POLICY_LEVELS) {
		const row = rows.find(
			(candidate) =>
				matchesLevel(candidate, level, requester) &&
				candidate.assignmentActive &&
				(candidate.effectiveFrom === null || candidate.effectiveFrom <= at) &&
				candidate.effectiveUntil === null,
		);
		if (row?.policyActive) return row;
	}
	return null;
}

/**
 * The change policy manual work applies (`resolveEffectiveChangePolicy`): active, effective and
 * not expired, employee then team then organization; two candidates at the deciding level are
 * ambiguous.
 */
function manualChangePolicy(
	rows: readonly ChangePolicyRow[],
	requester: Requester,
	at: Date,
): ChangePolicyFacts | null | "ambiguous" {
	for (const level of CHANGE_POLICY_LEVELS) {
		const candidates = rows.filter(
			(candidate) =>
				matchesLevel(candidate, level, requester) &&
				candidate.assignmentActive &&
				candidate.policyActive &&
				(candidate.effectiveFrom === null || candidate.effectiveFrom <= at) &&
				(candidate.effectiveUntil === null || candidate.effectiveUntil > at),
		);
		if (candidates.length > 1) return "ambiguous";
		const [row] = candidates;
		if (row) return row;
	}
	return null;
}
