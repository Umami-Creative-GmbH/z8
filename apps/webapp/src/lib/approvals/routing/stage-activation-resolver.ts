import { sql } from "drizzle-orm";
import {
	type EscalationCandidateExecutor,
	hasApprovalDecisionPath,
} from "../escalation/candidates";
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
	type ApprovalStageReviewerDirectory,
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
	departureReplacements: unknown[];
} {
	if (
		!isRecord(value) ||
		!Array.isArray(value.rows) ||
		value.rows.length !== 1 ||
		!isRecord(value.rows[0]) ||
		!Array.isArray(value.rows[0].employees) ||
		!Array.isArray(value.rows[0].managerLinks) ||
		!Array.isArray(value.rows[0].teamMemberships) ||
		!Array.isArray(value.rows[0].teams) ||
		(value.rows[0].departureReplacements !== undefined &&
			!Array.isArray(value.rows[0].departureReplacements))
	) {
		return invalid("Malformed approval directory query result.");
	}
	return {
		employees: value.rows[0].employees,
		managerLinks: value.rows[0].managerLinks,
		teamMemberships: value.rows[0].teamMemberships,
		teams: value.rows[0].teams,
		departureReplacements: (value.rows[0].departureReplacements ??
			[]) as unknown[],
	};
}

function decodeEmployees(rows: unknown[]): EligibleManagerEmployee[] {
	return rows.map((row) => {
		if (
			!isRecord(row) ||
			!nonEmptyString(row.id) ||
			!nonEmptyString(row.organizationId) ||
			typeof row.isActive !== "boolean" ||
			(row.teamId != null && !nonEmptyString(row.teamId)) ||
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
			teamId: row.teamId ?? null,
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

type DepartureReplacementRow = {
	employeeId: string;
	replacementEmployeeId: string;
	replacementUserId: string;
};

function decodeDepartureReplacements(
	rows: unknown[],
): DepartureReplacementRow[] {
	return rows.map((row) => {
		if (
			!isRecord(row) ||
			!nonEmptyString(row.employeeId) ||
			!nonEmptyString(row.replacementEmployeeId) ||
			!nonEmptyString(row.replacementUserId)
		) {
			return invalid("Malformed departure replacement directory row.");
		}
		return {
			employeeId: row.employeeId,
			replacementEmployeeId: row.replacementEmployeeId,
			replacementUserId: row.replacementUserId,
		};
	});
}

export type ReplacementDecisionPath = (
	executor: EscalationCandidateExecutor,
	input: {
		organizationId: string;
		requesterEmployeeId: string;
		managerEmployeeId: string;
		managerUserId: string;
	},
) => Promise<boolean>;

type DirectoryExecutor = {
	execute(query: ReturnType<typeof sql>): Promise<unknown>;
};

/**
 * The organization directory stage reviewers resolve from. Replacement rows
 * are loaded only for an explicitly named approver who left: the stage's own
 * assigned replacement, else the replacement of their latest departure or
 * unreactivated deactivation (#1440: the one chosen for this requester), and
 * only while the replacement is still an accessible, approved member who can
 * decide the requester's approvals: the same authority the handover checks
 * before a transfer. Without a named approver the directory is the
 * organization's alone, the same for every stage and requester.
 */
export async function loadApprovalStageDirectory(
	executor: DirectoryExecutor,
	input: {
		organizationId: string;
		hasDecisionPath?: ReplacementDecisionPath;
	} & (
		| { namedApproverId: null }
		| { namedApproverId: string; stageId: string; requesterEmployeeId: string }
	),
): Promise<ApprovalStageReviewerDirectory> {
	const hasDecisionPath = input.hasDecisionPath ?? hasApprovalDecisionPath;
	const { organizationId } = input;
	const named = input.namedApproverId === null ? null : input;
	// Replacement rows only for an explicitly named approver who left.
	const replacementsSql =
		named === null
			? sql`'[]'::json`
			: sql`coalesce((
				select json_agg(
					json_build_object(
						'employeeId', latest.employee_id,
						'replacementEmployeeId', replacement.id,
						'replacementUserId', replacement.user_id
					)
				)
				from (
					select distinct on (anchored.employee_id)
						anchored.employee_id, anchored.replacement_employee_id
					from (
						select departure.employee_id,
							coalesce(
								(stage_review.metadata->>'replacementEmployeeId')::uuid,
								departure.replacement_employee_id
							) as replacement_employee_id,
							departure.effective_at as anchored_at
						from employee_departure departure
						left join employee_departure_review stage_review
							on stage_review.organization_id = departure.organization_id
							and stage_review.departure_id = departure.id
							and stage_review.kind = 'approval_handover'
							and stage_review.subject_id = ${named.stageId}::uuid
						where departure.organization_id = ${organizationId}
							and departure.employee_id = ${named.namedApproverId}::uuid
							and departure.status = 'effective'
						union all
						-- A deactivation that still holds (#1440): the replacement
						-- chosen for this requester when the person left.
						select deactivation.employee_id,
							coalesce(
								(stage_review.metadata->>'replacementEmployeeId')::uuid,
								(deactivation.replacement_managers->>${named.requesterEmployeeId}::text)::uuid
							) as replacement_employee_id,
							deactivation.deactivated_at as anchored_at
						from employee_deactivation deactivation
						join employee deactivated
							on deactivated.id = deactivation.employee_id
							and deactivated.organization_id = deactivation.organization_id
							and deactivated.is_active = false
						left join employee_departure_review stage_review
							on stage_review.organization_id = deactivation.organization_id
							and stage_review.deactivation_id = deactivation.id
							and stage_review.kind = 'approval_handover'
							and stage_review.subject_id = ${named.stageId}::uuid
						where deactivation.organization_id = ${organizationId}
							and deactivation.employee_id = ${named.namedApproverId}::uuid
							and deactivation.reactivated_at is null
					) anchored
					order by anchored.employee_id, anchored.anchored_at desc
				) latest
				join employee replacement
					on replacement.id = latest.replacement_employee_id
					and replacement.organization_id = ${organizationId}
				where exists (
						select 1 from member
						where member.organization_id = replacement.organization_id
							and member.user_id = replacement.user_id
							and member.status = 'approved'
					)
					and not employee_departure_denies_access(
						replacement.organization_id, replacement.id, now()
					)
				), '[]'::json)`;
	const directoryResult = await executor.execute(sql`
				select
					coalesce((
						select json_agg(
							json_build_object(
								'id', employee.id,
								'organizationId', employee.organization_id,
								-- A due departure ends activity before it is materialized.
								'isActive', employee.is_active AND NOT employee_departure_denies_access(
									employee.organization_id, employee.id, now()
								),
								'role', employee.role,
								'teamId', employee.team_id
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
					), '[]'::json) as teams,
					${replacementsSql} as "departureReplacements"
			`);
	const directory = decodeDirectoryEnvelope(directoryResult);
	const replacements = decodeDepartureReplacements(directory.departureReplacements);
	const allowed =
		named === null
			? []
			: await Promise.all(
					replacements.map((row) =>
						hasDecisionPath(executor as EscalationCandidateExecutor, {
							organizationId,
							requesterEmployeeId: named.requesterEmployeeId,
							managerEmployeeId: row.replacementEmployeeId,
							managerUserId: row.replacementUserId,
						}),
					),
				);
	return {
		employees: decodeEmployees(directory.employees),
		managerLinks: decodeManagerLinks(directory.managerLinks),
		teamMemberships: decodeTeamMemberships(directory.teamMemberships),
		teams: decodeTeams(directory.teams),
		departureReplacements: replacements.filter((_, index) => allowed[index]),
	};
}

/**
 * Resolves stage reviewers from the organization directory. A stage naming a
 * person who left resolves to the replacement `loadApprovalStageDirectory`
 * finds for them.
 */
export function createDatabaseStageActivationResolver(
	deps: { hasDecisionPath?: ReplacementDecisionPath } = {},
): StageActivationResolver {
	return {
		async resolve(input) {
			const context = decodeRoutingContext(input.routingContext, input);
			const stage = decodeResolverSnapshot(input.stage.resolverSnapshot);
			// Only an explicitly named approver can be stood in for.
			const namedApproverId =
				stage.approverType === "specific_employee"
					? (stage.approverEmployeeId ?? null)
					: null;
			const directory = await loadApprovalStageDirectory(
				input.dbService.db,
				namedApproverId === null
					? {
							organizationId: input.organizationId,
							namedApproverId: null,
							hasDecisionPath: deps.hasDecisionPath,
						}
					: {
							organizationId: input.organizationId,
							stageId: input.stage.id,
							requesterEmployeeId: context.requesterEmployeeId,
							namedApproverId,
							hasDecisionPath: deps.hasDecisionPath,
						},
			);

			const resolution = resolveApprovalStageReviewers({
				context,
				stage,
				requesterMode: input.requesterMode ?? "new_submission",
				// start-workflow writes `{ kind: "default" }` when no policy matched.
				stageOrigin:
					input.workflow.policySnapshot.kind === "default" ? "default_approver" : "policy",
				directory,
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

/**
 * The reviewers a pending stage would resolve to with one employee gone, as
 * when they are deactivated (#1440, D2): that employee counts as inactive, so
 * their manager links and explicit naming fall through to the stage's own
 * rules and fallback. Empty when nobody else can review (a `fail` fallback,
 * an unsupported resolver, or only the requester).
 */
export function resolveStageReviewersWithout(input: {
	directory: ApprovalStageReviewerDirectory;
	employeeId: string;
	workflow: {
		id: string;
		organizationId: string;
		workflowType: ApprovalRoutingContext["workflowType"];
		sourceType: string;
		sourceId: string;
		requesterEmployeeId: string;
		policyKind: string | null;
	};
	resolverSnapshot: JsonObject;
}): string[] {
	const directory: ApprovalStageReviewerDirectory = {
		...input.directory,
		employees: input.directory.employees.map((employee) =>
			employee.id === input.employeeId ? { ...employee, isActive: false } : employee,
		),
	};
	try {
		const resolution = resolveApprovalStageReviewers({
			// Resolution reads only the organization, workflow type and requester.
			context: {
				organizationId: input.workflow.organizationId,
				workflowType: input.workflow.workflowType,
				source: { type: input.workflow.sourceType, id: input.workflow.sourceId },
				requesterEmployeeId: input.workflow.requesterEmployeeId,
				teamIds: [],
				locationId: null,
				absenceCategoryId: null,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
			},
			stage: decodeResolverSnapshot(input.resolverSnapshot),
			requesterMode: "existing_workflow",
			stageOrigin: input.workflow.policyKind === "default" ? "default_approver" : "policy",
			directory,
		});
		return resolution.activationMode === "human"
			? resolution.approverEmployeeIds.filter((id) => id !== input.employeeId)
			: [];
	} catch (error) {
		if (error instanceof ApprovalStageActivationError) return [];
		throw error;
	}
}
