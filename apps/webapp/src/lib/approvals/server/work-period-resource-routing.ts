import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import type { db } from "@/db";
import {
	approvalPolicy,
	employee,
	employeeManagers,
	team,
	teamMembership,
} from "@/db/schema";
import { resolveApproverFromDirectory } from "../policies/approver-resolution";
import type { ApprovalPolicyStageDraft } from "../policies/types";
import {
	ApprovalStageActivationError,
	resolveApprovalStageReviewers,
} from "../routing/approver-resolver";

/** Read-only scope routing, never an approval decision or fresh-policy validation.
 * Cover possible stages in both retained authority modes using their real
 * resolvers. Policy matching and authoritative execution remain with submission.
 */
export async function routeWorkPeriodApprovalParticipants(input: {
	db: Pick<typeof db, "query">;
	organizationId: string;
	requesterEmployeeId: string;
}) {
	const [employees, policies, memberships, teams] = await Promise.all([
		input.db.query.employee.findMany({
			where: eq(employee.organizationId, input.organizationId),
		}),
		input.db.query.approvalPolicy.findMany({
			where: and(
				eq(approvalPolicy.organizationId, input.organizationId),
				eq(approvalPolicy.isActive, true),
			),
			with: { stages: true },
		}),
		input.db.query.teamMembership.findMany({
			where: and(
				eq(teamMembership.organizationId, input.organizationId),
				eq(teamMembership.employeeId, input.requesterEmployeeId),
			),
		}),
		input.db.query.team.findMany({
			where: eq(team.organizationId, input.organizationId),
		}),
	]);
	const managerLinks =
		employees.length === 0
			? []
			: await input.db.query.employeeManagers.findMany({
					where: inArray(
						employeeManagers.employeeId,
						employees.map(({ id }) => id),
					),
				});
	const directory = {
		employees,
		managerLinks,
		teamMemberships: memberships,
		teams,
	};
	const ids = new Set([input.requesterEmployeeId]);
	const stages: ApprovalPolicyStageDraft[] = [
		{
			id: "default-manager-routing",
			stepOrder: 0,
			label: "Default manager",
			approverType: "direct_manager",
			fallbackBehavior: "fail",
		},
		...policies.flatMap((policy) =>
			policy.stages.map(
				(stage): ApprovalPolicyStageDraft => ({
					...stage,
					approverEmployeeId: stage.approverEmployeeId ?? undefined,
					fallbackBehavior:
						stage.fallbackBehavior === "default_manager" ||
						stage.fallbackBehavior === "organization_admin"
							? stage.fallbackBehavior
							: "fail",
				}),
			),
		),
	];
	for (const stage of stages) {
		const legacy = resolveApproverFromDirectory({
			...directory,
			organizationId: input.organizationId,
			requesterEmployeeId: input.requesterEmployeeId,
			stage,
		});
		if (legacy.ok) ids.add(legacy.approverEmployeeId);
		try {
			const canonical = resolveApprovalStageReviewers({
				directory,
				stage: {
					...stage,
					approverEmployeeId: stage.approverEmployeeId ?? undefined,
				},
				context: {
					organizationId: input.organizationId,
					workflowType: "policy_clock_out",
					source: { type: "time_entry", id: "routing-only" },
					requesterEmployeeId: input.requesterEmployeeId,
					teamIds: [],
					locationId: null,
					absenceCategoryId: null,
					travelExpenseAmount: null,
					overtimeRisk: "warning",
					employeeGroupIds: [],
				},
			});
			if (canonical.activationMode === "human") {
				for (const id of canonical.approverEmployeeIds) ids.add(id);
			}
		} catch (error) {
			// Invalid/unroutable policy still fails at its established submission
			// boundary, not during committed replay or this read-only inventory.
			if (!(error instanceof ApprovalStageActivationError)) throw error;
		}
	}
	return {
		employeeIds: [...ids].sort(),
		userIds: [
			...new Set(
				employees
					.filter(({ id }) => ids.has(id))
					.flatMap(({ userId }) => (userId ? [userId] : [])),
			),
		].sort(),
	};
}
