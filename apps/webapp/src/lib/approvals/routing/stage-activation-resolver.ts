import { sql } from "drizzle-orm";
import type {
	EligibleManagerEmployee,
	EligibleManagerLink,
	EligibleTeam,
	EligibleTeamMembership,
} from "../policies/manager-eligibility";
import type {
	JsonObject,
	StageActivationInput,
	StageActivationResolver,
} from "../workflow/ports";
import {
	ApprovalStageActivationError,
	type ApprovalStageResolverSnapshot,
	resolveApprovalStageReviewers,
} from "./approver-resolver";
import type { ApprovalRoutingContext } from "./types";

function invalid(message: string): never {
	throw new ApprovalStageActivationError("invalid_stage_resolver", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function nullableString(value: unknown): value is string | null {
	return value === null || typeof value === "string";
}

function decodeRoutingContext(
	value: JsonObject,
	input: StageActivationInput,
): ApprovalRoutingContext {
	const source = value.source;
	if (
		!nonEmptyString(value.organizationId) ||
		!nonEmptyString(value.workflowType) ||
		!isRecord(source) ||
		!nonEmptyString(source.type) ||
		!nonEmptyString(source.id) ||
		!nonEmptyString(value.requesterEmployeeId) ||
		!stringArray(value.teamIds) ||
		!nullableString(value.locationId) ||
		!nullableString(value.absenceCategoryId) ||
		(value.travelExpenseAmount !== null &&
			(typeof value.travelExpenseAmount !== "number" ||
				!Number.isFinite(value.travelExpenseAmount))) ||
		(value.overtimeRisk !== null &&
			value.overtimeRisk !== "none" &&
			value.overtimeRisk !== "warning" &&
			value.overtimeRisk !== "violation") ||
		!stringArray(value.employeeGroupIds)
	) {
		return invalid("Malformed approval routing context.");
	}

	if (
		input.organizationId !== input.workflow.organizationId ||
		input.stage.organizationId !== input.organizationId ||
		input.stage.workflowId !== input.workflow.id ||
		value.organizationId !== input.workflow.organizationId ||
		value.workflowType !== input.workflow.workflowType ||
		input.workflow.requesterEmployeeId === null ||
		value.requesterEmployeeId !== input.workflow.requesterEmployeeId ||
		source.type !== input.workflow.sourceType ||
		source.id !== input.workflow.sourceId
	) {
		return invalid(
			"Approval routing context identity does not match the workflow.",
		);
	}

	return {
		organizationId: value.organizationId,
		workflowType: input.workflow.workflowType,
		source: { type: source.type, id: source.id },
		requesterEmployeeId: value.requesterEmployeeId,
		teamIds: value.teamIds,
		locationId: value.locationId,
		absenceCategoryId: value.absenceCategoryId,
		travelExpenseAmount: value.travelExpenseAmount,
		overtimeRisk: value.overtimeRisk,
		employeeGroupIds: value.employeeGroupIds,
	};
}

function decodeResolverSnapshot(
	value: JsonObject,
): ApprovalStageResolverSnapshot {
	if (
		!nonEmptyString(value.approverType) ||
		!nonEmptyString(value.fallbackBehavior) ||
		("approverEmployeeId" in value &&
			typeof value.approverEmployeeId !== "string")
	) {
		return invalid("Malformed approval stage resolver snapshot.");
	}

	return {
		approverType: value.approverType,
		fallbackBehavior: value.fallbackBehavior,
		...(typeof value.approverEmployeeId === "string"
			? { approverEmployeeId: value.approverEmployeeId }
			: {}),
	};
}

function decodeDirectoryEnvelope(value: unknown): {
	employees: unknown[];
	managerLinks: unknown[];
	teamMemberships: unknown[];
	teams: unknown[];
} {
	if (
		!isRecord(value) ||
		!Array.isArray(value.rows) ||
		value.rows.length !== 1 ||
		!isRecord(value.rows[0]) ||
		!Array.isArray(value.rows[0].employees) ||
		!Array.isArray(value.rows[0].managerLinks) ||
		!Array.isArray(value.rows[0].teamMemberships) ||
		!Array.isArray(value.rows[0].teams)
	) {
		return invalid("Malformed approval directory query result.");
	}
	return {
		employees: value.rows[0].employees,
		managerLinks: value.rows[0].managerLinks,
		teamMemberships: value.rows[0].teamMemberships,
		teams: value.rows[0].teams,
	};
}

function decodeEmployees(rows: unknown[]): EligibleManagerEmployee[] {
	return rows.map((row) => {
		if (
			!isRecord(row) ||
			!nonEmptyString(row.id) ||
			!nonEmptyString(row.organizationId) ||
			typeof row.isActive !== "boolean" ||
			(row.role !== "admin" &&
				row.role !== "manager" &&
				row.role !== "employee")
		) {
			return invalid("Malformed employee directory row.");
		}
		return {
			id: row.id,
			organizationId: row.organizationId,
			isActive: row.isActive,
			role: row.role,
		};
	});
}

function decodeManagerLinks(rows: unknown[]): EligibleManagerLink[] {
	return rows.map((row) => {
		if (
			!isRecord(row) ||
			!nonEmptyString(row.employeeId) ||
			!nonEmptyString(row.managerId) ||
			typeof row.isPrimary !== "boolean"
		) {
			return invalid("Malformed employee manager directory row.");
		}
		return {
			employeeId: row.employeeId,
			managerId: row.managerId,
			isPrimary: row.isPrimary,
		};
	});
}

function decodeTeamMemberships(rows: unknown[]): EligibleTeamMembership[] {
	return rows.map((row) => {
		if (
			!isRecord(row) ||
			!nonEmptyString(row.employeeId) ||
			!nonEmptyString(row.teamId)
		) {
			return invalid("Malformed team membership directory row.");
		}
		return { employeeId: row.employeeId, teamId: row.teamId };
	});
}

function decodeTeams(rows: unknown[]): EligibleTeam[] {
	return rows.map((row) => {
		if (
			!isRecord(row) ||
			!nonEmptyString(row.id) ||
			!nonEmptyString(row.organizationId) ||
			(row.primaryManagerId !== null && !nonEmptyString(row.primaryManagerId))
		) {
			return invalid("Malformed team directory row.");
		}
		return {
			id: row.id,
			organizationId: row.organizationId,
			primaryManagerId: row.primaryManagerId,
		};
	});
}

export function createDatabaseStageActivationResolver(): StageActivationResolver {
	return {
		async resolve(input) {
			const context = decodeRoutingContext(input.routingContext, input);
			const stage = decodeResolverSnapshot(input.stage.resolverSnapshot);
			const organizationId = input.organizationId;
			const directoryResult = await input.dbService.db.execute(sql`
				select
					coalesce((
						select json_agg(
							json_build_object(
								'id', employee.id,
								'organizationId', employee.organization_id,
								'isActive', employee.is_active,
								'role', employee.role
							)
							order by employee.id
						)
						from employee
						where employee.organization_id = ${organizationId}
					), '[]'::json) as employees,
					coalesce((
						select json_agg(
							json_build_object(
								'employeeId', managers.employee_id,
								'managerId', managers.manager_id,
								'isPrimary', managers.is_primary
							)
							order by managers.employee_id, managers.manager_id, managers.is_primary
						)
						from employee_managers managers
						join employee subject on subject.id = managers.employee_id
						where subject.organization_id = ${organizationId}
					), '[]'::json) as "managerLinks",
					coalesce((
						select json_agg(
							json_build_object(
								'employeeId', team_membership.employee_id,
								'teamId', team_membership.team_id
							)
							order by team_membership.employee_id, team_membership.team_id
						)
						from team_membership
						where team_membership.organization_id = ${organizationId}
					), '[]'::json) as "teamMemberships",
					coalesce((
						select json_agg(
							json_build_object(
								'id', team.id,
								'organizationId', team.organization_id,
								'primaryManagerId', team.primary_manager_id
							)
							order by team.id
						)
						from team
						where team.organization_id = ${organizationId}
					), '[]'::json) as teams
			`);
			const directory = decodeDirectoryEnvelope(directoryResult);

			const resolution = resolveApprovalStageReviewers({
				context,
				stage,
				directory: {
					employees: decodeEmployees(directory.employees),
					managerLinks: decodeManagerLinks(directory.managerLinks),
					teamMemberships: decodeTeamMemberships(directory.teamMemberships),
					teams: decodeTeams(directory.teams),
				},
			});

			return resolution.activationMode === "human"
				? {
						organizationId: input.organizationId,
						workflowId: input.workflow.id,
						stageId: input.stage.id,
						activationMode: "human",
						assignments: resolution.approverEmployeeIds.map(
							(approverEmployeeId) => ({ approverEmployeeId, metadata: {} }),
						),
					}
				: {
						organizationId: input.organizationId,
						workflowId: input.workflow.id,
						stageId: input.stage.id,
						activationMode: "requester_auto_approve",
						assignments: [],
					};
		},
	};
}
