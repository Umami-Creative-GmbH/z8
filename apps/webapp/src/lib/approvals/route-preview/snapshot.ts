import { and, asc, eq } from "drizzle-orm";
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
import { customRole, customRolePermission, employeeCustomRole } from "@/db/schema/custom-role";
import type { Action, Subject } from "@/lib/authorization/types";
import { type Instant, instantFromDate } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { onCurrentRoster } from "@/lib/employee-lifecycle/current-roster";
import type { ChangePolicyCandidate } from "@/lib/time-tracking/change-policy/resolution";
import type { ChangePolicyWindowTerms } from "@/lib/time-tracking/change-policy/verdict";
import { loadCollectsPeriodSubmissions } from "@/lib/time-tracking/period-submissions/settings";
import { readApprovalAuthoritySnapshots, readApprovalWriteGateOpenSnapshot } from "../authority";
import { type DbPolicyRecord, policyFromDbRecord } from "../policies/chain-service";
import type {
	EligibleManagerEmployee,
	EligibleManagerLink,
	EligibleTeam,
	EligibleTeamMembership,
} from "../policies/manager-eligibility";
import type { ApprovalPolicyDraft } from "../policies/types";
import { absenceCategoryNeedsApproval } from "../route-rules";
import type { ApprovalStageReviewerDirectory } from "../routing/approver-resolver";
import { loadApprovalStageDirectory } from "../routing/stage-activation-resolver";
import {
	ApprovalWorkflowStartError,
	loadApprovalWorkflowStartPolicies,
} from "../workflow/start-workflow";
import { APPROVAL_ROUTE_KINDS, type ApprovalRouteKind } from "./types";

/** The kinds with a legacy path: their approval authority decides how they route. */
const AUTHORITY_KINDS = [
	"absence",
	"time_correction",
	"manual_time_submission",
	"travel_expense",
] as const satisfies readonly ApprovalRouteKind[];
export type ApprovalRouteAuthorityKind = (typeof AUTHORITY_KINDS)[number];

/**
 * The kinds a canonical workflow start can route. Period submissions are canonical-only; the
 * others route canonically under canonical authority.
 */
const CANONICAL_KINDS = [
	"absence",
	"time_correction",
	"manual_time_submission",
	"period_submission",
] as const satisfies readonly ApprovalRouteKind[];
export type ApprovalRouteCanonicalKind = (typeof CANONICAL_KINDS)[number];

/** A permission a custom role grants, as the permission system reads it. */
export type ApprovalRoutePermission = { action: Action; subject: Subject };

export type ApprovalRouteChangePolicy = ChangePolicyCandidate & ChangePolicyWindowTerms;

/**
 * Everything an approval route preview reads for one organization at one instant, read once.
 * Requesters are routed from it in memory; only a stage naming an approver who left reads more.
 */
export interface ApprovalRouteSnapshot {
	organizationId: string;
	at: Instant;
	/** Kinds previewed, in display order, and kinds switched off (not previewed). */
	kinds: readonly ApprovalRouteKind[];
	offKinds: readonly ApprovalRouteKind[];
	authority: Record<ApprovalRouteAuthorityKind, "legacy" | "canonical">;
	/** Period submissions are canonical-only: they can start only in `complete` mode. */
	periodSubmissionWriteGateOpen: boolean;
	/** Active policies of each canonical kind as a start reads them, or "invalid" when it can't. */
	canonicalPolicies: Partial<Record<ApprovalRouteCanonicalKind, ApprovalPolicyDraft[] | "invalid">>;
	/** The directory canonical stages resolve from, with departures decided at `at`. */
	stageDirectory: ApprovalStageReviewerDirectory;
	/**
	 * The organization's employees as legacy routing reads them: the stored activity flag, as
	 * `getPrimaryEligibleManagerIdForRequester` reads it.
	 */
	employees: Array<EligibleManagerEmployee & { teamId: string | null; userId: string | null }>;
	managerLinks: EligibleManagerLink[];
	teamMemberships: EligibleTeamMembership[];
	teams: EligibleTeam[];
	/** Every approval policy of the organization, as legacy routing reads them. */
	legacyPolicies: ApprovalPolicyDraft[];
	/** Active employee group ids by employee. */
	employeeGroupIds: ReadonlyMap<string, readonly string[]>;
	changePolicies: ApprovalRouteChangePolicy[];
	/** Active absence categories that require approval. */
	approvalCategoryIds: string[];
	expenseApproverEmployeeId: string | null;
	/** Approved members' organization roles, by user id. */
	memberRoles: ReadonlyMap<string, string>;
	/** What the employee's active custom roles of the organization grant, by employee id. */
	customRolePermissions: ReadonlyMap<string, readonly ApprovalRoutePermission[]>;
	/** Employees on the current roster at `at`, with their employee role. */
	roster: Array<{ id: string; role: string }>;
}

/**
 * Reads what an approval route preview needs for `organizationId` at the explicit instant `at`,
 * once, through the caller's reader: approval authority, canonical and legacy policies, the
 * directories, change policies, categories, expense and shift settings. Departures are decided at
 * `at`, not at the database's current time. Pure SELECTs, one after another (a transaction's
 * connection runs one query at a time).
 */
export async function loadApprovalRouteSnapshot(
	reader: DatabaseClient,
	input: { organizationId: string; at: Instant },
): Promise<ApprovalRouteSnapshot> {
	const { organizationId, at } = input;
	const [
		authority,
		stageDirectory,
		employeeRows,
		managerLinks,
		teamMemberships,
		teams,
		legacyPolicyRecords,
		groupMembers,
		changePolicyRows,
		activeCategories,
		expenseSettings,
		memberRoles,
		collectsPeriods,
		organizationRow,
		roster,
		periodSubmissionWriteGateOpen,
	] = await inOrder([
		() => readApprovalAuthoritySnapshots(reader, organizationId, AUTHORITY_KINDS),
		() => loadApprovalStageDirectory(reader, { organizationId, namedApproverId: null, at }),
		// Legacy routing reads the stored activity flag, as `getPrimaryEligibleManagerIdForRequester` does.
		() =>
			reader.query.employee.findMany({
				columns: {
					id: true,
					organizationId: true,
					isActive: true,
					role: true,
					teamId: true,
					userId: true,
				},
				where: eq(employee.organizationId, organizationId),
			}),
		() =>
			reader
				.select({
					employeeId: employeeManagers.employeeId,
					managerId: employeeManagers.managerId,
					isPrimary: employeeManagers.isPrimary,
				})
				.from(employeeManagers)
				.innerJoin(employee, eq(employee.id, employeeManagers.employeeId))
				.where(eq(employee.organizationId, organizationId)),
		() =>
			reader
				.select({ employeeId: teamMembership.employeeId, teamId: teamMembership.teamId })
				.from(teamMembership)
				.where(eq(teamMembership.organizationId, organizationId)),
		() =>
			reader
				.select({
					id: team.id,
					organizationId: team.organizationId,
					primaryManagerId: team.primaryManagerId,
				})
				.from(team)
				.where(eq(team.organizationId, organizationId)),
		() =>
			reader.query.approvalPolicy.findMany({
				where: eq(approvalPolicy.organizationId, organizationId),
				orderBy: [asc(approvalPolicy.priority)],
				with: { conditions: true, stages: true },
			}),
		() =>
			reader
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
			reader
				.select({
					assignmentId: changePolicyAssignment.id,
					level: changePolicyAssignment.assignmentType,
					organizationId: changePolicyAssignment.organizationId,
					employeeId: changePolicyAssignment.employeeId,
					teamId: changePolicyAssignment.teamId,
					assignmentActive: changePolicyAssignment.isActive,
					effectiveFrom: changePolicyAssignment.effectiveFrom,
					effectiveUntil: changePolicyAssignment.effectiveUntil,
					policyOrganizationId: changePolicy.organizationId,
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
			reader
				.select({ id: absenceCategory.id, requiresApproval: absenceCategory.requiresApproval })
				.from(absenceCategory)
				.where(
					and(
						eq(absenceCategory.organizationId, organizationId),
						eq(absenceCategory.isActive, true),
					),
				)
				.orderBy(asc(absenceCategory.id)),
		() =>
			reader
				.select({ expenseApproverEmployeeId: travelExpenseSettings.expenseApproverEmployeeId })
				.from(travelExpenseSettings)
				.where(eq(travelExpenseSettings.organizationId, organizationId))
				.limit(1),
		() =>
			reader
				.select({ userId: member.userId, role: member.role })
				.from(member)
				.where(and(eq(member.organizationId, organizationId), eq(member.status, "approved"))),
		() =>
			loadCollectsPeriodSubmissions(reader, organizationId, {
				clock: { nowInstant: () => at },
			}),
		() =>
			reader
				.select({ shiftsEnabled: organization.shiftsEnabled })
				.from(organization)
				.where(eq(organization.id, organizationId))
				.limit(1),
		() =>
			reader
				.select({ id: employee.id, role: employee.role })
				.from(employee)
				.where(onCurrentRoster(organizationId, employee, at)),
		() =>
			readApprovalWriteGateOpenSnapshot(reader, {
				organizationId,
				workflowType: "period_submission",
			}),
	]);

	// Custom role grants, read as the permission system loads them for one employee.
	const customRoleGrants = await reader
		.select({
			employeeId: employeeCustomRole.employeeId,
			action: customRolePermission.action,
			subject: customRolePermission.subject,
		})
		.from(employeeCustomRole)
		.innerJoin(
			customRole,
			and(
				eq(customRole.id, employeeCustomRole.customRoleId),
				eq(customRole.organizationId, organizationId),
				eq(customRole.isActive, true),
			),
		)
		.innerJoin(customRolePermission, eq(customRolePermission.customRoleId, customRole.id));
	const customRolePermissions = groupByEmployee(
		customRoleGrants,
		(grant): ApprovalRoutePermission => ({
			action: grant.action as Action,
			subject: grant.subject as Subject,
		}),
	);

	const offKinds: ApprovalRouteKind[] = [];
	if (!collectsPeriods) offKinds.push("period_submission");
	if (!organizationRow[0]?.shiftsEnabled) offKinds.push("shift_request");
	const kinds = APPROVAL_ROUTE_KINDS.filter((kind) => !offKinds.includes(kind));

	const authorities = Object.fromEntries(
		AUTHORITY_KINDS.map((kind) => [
			kind,
			authority.get(kind)?.authority === "canonical" ? "canonical" : "legacy",
		]),
	) as ApprovalRouteSnapshot["authority"];
	const canonicalKinds = CANONICAL_KINDS.filter((kind) =>
		kind === "period_submission" ? kinds.includes(kind) : authorities[kind] === "canonical",
	);
	const canonicalPolicies: ApprovalRouteSnapshot["canonicalPolicies"] = {};
	for (const kind of canonicalKinds) {
		try {
			canonicalPolicies[kind] = await loadApprovalWorkflowStartPolicies(reader, {
				organizationId,
				workflowType: kind,
			});
		} catch (error) {
			if (!(error instanceof ApprovalWorkflowStartError) || error.code !== "INVALID_POLICY") {
				throw error;
			}
			canonicalPolicies[kind] = "invalid";
		}
	}

	const employeeGroupIds = groupByEmployee(groupMembers, (row) => row.groupId);

	return {
		organizationId,
		at,
		kinds,
		offKinds,
		authority: authorities,
		periodSubmissionWriteGateOpen,
		canonicalPolicies,
		stageDirectory,
		employees: employeeRows.map((row) => ({ ...row, teamId: row.teamId ?? null })),
		managerLinks,
		teamMemberships,
		teams,
		legacyPolicies: (legacyPolicyRecords as unknown as DbPolicyRecord[]).map(policyFromDbRecord),
		employeeGroupIds,
		changePolicies: changePolicyRows.map((row) => ({
			...row,
			effectiveFrom: row.effectiveFrom ? instantFromDate(row.effectiveFrom) : null,
			effectiveUntil: row.effectiveUntil ? instantFromDate(row.effectiveUntil) : null,
		})),
		approvalCategoryIds: activeCategories.filter(absenceCategoryNeedsApproval).map((row) => row.id),
		expenseApproverEmployeeId: expenseSettings[0]?.expenseApproverEmployeeId ?? null,
		memberRoles: new Map(memberRoles.map((row) => [row.userId, row.role])),
		customRolePermissions,
		roster,
	};
}

/** Each employee's values, in row order. */
function groupByEmployee<Row extends { employeeId: string }, Value>(
	rows: readonly Row[],
	toValue: (row: Row) => Value,
): Map<string, Value[]> {
	const grouped = new Map<string, Value[]>();
	for (const row of rows) {
		const values = grouped.get(row.employeeId);
		if (values) values.push(toValue(row));
		else grouped.set(row.employeeId, [toValue(row)]);
	}
	return grouped;
}

/** Runs reads one after another: a transaction's connection runs one query at a time. */
async function inOrder<const T extends readonly (() => PromiseLike<unknown>)[]>(
	reads: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
	const results: unknown[] = [];
	for (const read of reads) results.push(await read());
	return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
