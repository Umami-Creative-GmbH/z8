/**
 * The employee deactivation's narrow cancellation capability (#1440, Organization ADR 0006).
 *
 * A deactivation cancels the former employee's pending and approved absences that start after
 * the day they left, inside its own transaction and through the normal cancellation path. The
 * system principal carries no evidence of its own: the authorization re-reads it in the
 * command's transaction from the workflow. The requester must be switched off with a recorded
 * deactivation instant, and the absence must still be pending or approved and start after that
 * instant's calendar date in the organization's zone (the date `employee_left_on` reports).
 * Absences spanning that day, other kinds of workflow and every other command stay out of reach.
 */
import { sql } from "drizzle-orm";
import {
	type ApprovalDbService,
	type ApprovalWorkflowAuthorizationGrant,
	type ApprovalWorkflowCommandRequest,
	type ApprovalWorkflowPrincipal,
	type ApprovalWorkflowSnapshot,
	EMPLOYEE_DEACTIVATION_CANCEL_REASON,
	EMPLOYEE_DEACTIVATION_SYSTEM_ID,
} from "./ports";
import type { ApprovalWorkflowCommand } from "./state-machine";

export function isEmployeeDeactivationPrincipal(
	principal: ApprovalWorkflowPrincipal | undefined,
): boolean {
	return principal?.kind === "system" && principal.systemId === EMPLOYEE_DEACTIVATION_SYSTEM_ID;
}

/**
 * What the engine tells the domain adapter, so the absence adapter can admit cancelling an
 * approved absence for the capability (its owner rule needs the employee as actor).
 */
export function employeeDeactivationAdapterCapability(principal: ApprovalWorkflowPrincipal): {
	systemCapability?: typeof EMPLOYEE_DEACTIVATION_SYSTEM_ID;
} {
	return isEmployeeDeactivationPrincipal(principal)
		? { systemCapability: EMPLOYEE_DEACTIVATION_SYSTEM_ID }
		: {};
}

/** The engine admits the capability for exactly this command. */
export function allowsEmployeeDeactivationCancellation(
	request: ApprovalWorkflowCommandRequest,
	authorization: ApprovalWorkflowAuthorizationGrant,
	workflowType: string,
): boolean {
	return (
		authorization === "system" &&
		workflowType === "absence" &&
		request.command.type === "cancel" &&
		request.command.reason === EMPLOYEE_DEACTIVATION_CANCEL_REASON
	);
}

function resultRows(value: unknown): unknown[] {
	return typeof value === "object" && value !== null && "rows" in value && Array.isArray(value.rows)
		? value.rows
		: [];
}

export class EmployeeDeactivationCancellationRefused extends Error {
	constructor(readonly field: string) {
		super(`Employee deactivation cancellation refused: ${field}`);
		this.name = "EmployeeDeactivationCancellationRefused";
	}
}

/**
 * Verifies the evidence in the command's transaction and grants the generic system grant, which
 * `allowsEmployeeDeactivationCancellation` narrows to the cancel. Throws when it does not hold.
 */
export async function authorizeEmployeeDeactivationCancellation(input: {
	dbService: ApprovalDbService;
	organizationId: string;
	workflow: ApprovalWorkflowSnapshot;
	command: ApprovalWorkflowCommand;
}): Promise<ApprovalWorkflowAuthorizationGrant> {
	const { workflow } = input;
	if (
		input.command.type !== "cancel" ||
		input.command.reason !== EMPLOYEE_DEACTIVATION_CANCEL_REASON ||
		workflow.organizationId !== input.organizationId ||
		workflow.workflowType !== "absence" ||
		workflow.sourceType !== "absence_entry" ||
		(workflow.status !== "pending" && workflow.status !== "approved")
	) {
		throw new EmployeeDeactivationCancellationRefused("command");
	}
	const rows = resultRows(
		await input.dbService.db.execute(sql`
			select a.id
			from absence_entry a
			join employee e
				on e.id = a.employee_id and e.organization_id = a.organization_id
			where a.organization_id = ${input.organizationId}
				and a.id = ${workflow.sourceId}::uuid
				and a.approval_workflow_id = ${workflow.id}::uuid
				and a.employee_id = ${workflow.requesterEmployeeId}::uuid
				and a.status in ('pending', 'approved')
				and e.is_active = false
				and e.deactivated_at is not null
				and a.start_date > (
					e.deactivated_at at time zone vacation_organization_timezone(e.organization_id)
				)::date
			limit 2
		`),
	);
	if (rows.length !== 1) throw new EmployeeDeactivationCancellationRefused("evidence");
	return "system";
}
