"use server";

import { Effect } from "effect";
import type { ZodType } from "zod";
import {
	type AnyAppError,
	AuthorizationError,
	DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import type { ServerActionResult } from "@/lib/effect/result";
import {
	DepartureCommandError,
	type DepartureCommandErrorCode,
	getDepartureCommands,
} from "@/lib/employee-lifecycle";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";
import type { ExecuteDepartureResult, LifecycleActor } from "@/lib/employee-lifecycle/types";
import { createLogger } from "@/lib/logger";
import {
	cancelDepartureSchema,
	offboardNowSchema,
	rehireEmployeeSchema,
	scheduleDepartureSchema,
} from "@/lib/validations/employee-offboarding";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
	revalidateEmployeesCache,
	runTracedEmployeeAction,
	validateInput,
} from "./employee-action-utils";

const logger = createLogger("EmployeeOffboardingActions");

type DepartureCommands = ReturnType<typeof getDepartureCommands>;

const commandMessages: Record<DepartureCommandErrorCode, string> = {
	actor_not_authorized: "Only organization owners and admins can manage employee departures.",
	self_target: "You cannot offboard or rehire your own employee profile.",
	owner_authorization_required: "Only an organization owner can offboard or rehire an owner.",
	initiator_authorization_lost:
		"Only organization owners and admins can manage employee departures.",
	final_accessible_owner: "Assign and activate another approved owner before this employee leaves.",
	employee_not_found: "Employee not found.",
	no_open_employment_period: "This employee has no current employment to end.",
	departure_already_pending:
		"A departure is already scheduled for this employee. Edit or cancel it instead.",
	departure_revision_conflict:
		"This departure changed in the meantime. Reload and review it before trying again.",
	departure_already_effective:
		"This departure has already taken effect. Rehire the employee to restore access.",
	departure_date_in_past: "The last working day cannot be in the past.",
	invalid_timezone: "The organization timezone is invalid. Fix it in organization settings first.",
	replacement_invalid: "Choose an active colleague in this organization as the replacement.",
	replacement_required:
		"This employee has open approval duties. Choose a replacement or confirm admins will resolve them.",
	request_conflict: "This request was already used for different details. Please try again.",
	membership_required:
		"This person is no longer an approved organization member. Re-invite them before rehiring.",
	employee_already_employed: "This employee is already employed.",
	rehire_conflict:
		"The previous employment period changed in the meantime. Reload and review it before trying again.",
	rehire_terms_invalid:
		"Choose a work policy, team and manager from this organization, and complete the contract terms.",
};

const authorizationCodes = new Set<DepartureCommandErrorCode>([
	"actor_not_authorized",
	"self_target",
	"owner_authorization_required",
	"initiator_authorization_lost",
]);

function toAppError(error: unknown, actor: LifecycleActor, action: string): AnyAppError {
	if (!(error instanceof DepartureCommandError)) {
		return new DatabaseError({
			message: "Employee departure could not be saved. Please try again.",
			operation: action,
			cause: error,
		});
	}
	const message = commandMessages[error.code];
	if (authorizationCodes.has(error.code)) {
		return new AuthorizationError({
			message,
			userId: actor.userId,
			resource: "employee",
			action,
		});
	}
	if (error.code === "employee_not_found") {
		return new NotFoundError({ message, entityType: "employee" });
	}
	return new ValidationError({ message, field: error.code });
}

/**
 * Shared adapter: the release gate is checked before anything else, then the
 * actor's org-admin settings access, then payload validation. Authority over
 * the target is re-checked by the command under the lifecycle locks.
 */
function runDepartureCommand<TInput, TResult>(options: {
	name: string;
	input: unknown;
	schema: ZodType<TInput>;
	run: (commands: DepartureCommands, actor: LifecycleActor, input: TInput) => Promise<TResult>;
}): Promise<ServerActionResult<TResult>> {
	return runTracedEmployeeAction({
		name: options.name,
		logError: (error) => {
			logger.error({ error }, `Failed to ${options.name}`);
		},
		execute: () =>
			Effect.gen(function* (_) {
				if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
					return yield* _(
						Effect.fail(
							new ValidationError({
								message: "Employee offboarding is not available yet.",
								field: "employeeId",
							}),
						),
					);
				}

				const actorContext = yield* _(
					getEmployeeSettingsActorContext({ queryName: `${options.name}:actor` }),
				);
				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actorContext, {
						message: commandMessages.actor_not_authorized,
						resource: "employee",
						action: options.name,
					}),
				);
				const input = yield* _(validateInput(options.schema, options.input));
				const actor = {
					userId: actorContext.session.user.id,
					organizationId: actorContext.organizationId,
				};

				const result = yield* _(
					Effect.tryPromise({
						try: () => options.run(getDepartureCommands(), actor, input),
						catch: (error) => toAppError(error, actor, options.name),
					}),
				);
				revalidateEmployeesCache(actor.organizationId);
				return result;
			}),
	});
}

export async function scheduleEmployeeDepartureAction(
	input: unknown,
): Promise<ServerActionResult<{ departureId: string; revision: number }>> {
	return runDepartureCommand({
		name: "scheduleEmployeeDeparture",
		input,
		schema: scheduleDepartureSchema,
		run: (commands, actor, data) => commands.scheduleDeparture(actor, data),
	});
}

export async function cancelEmployeeDepartureAction(
	input: unknown,
): Promise<ServerActionResult<void>> {
	return runDepartureCommand({
		name: "cancelEmployeeDeparture",
		input,
		schema: cancelDepartureSchema,
		run: (commands, actor, data) => commands.cancelDeparture(actor, data),
	});
}

export async function offboardEmployeeNowAction(
	input: unknown,
): Promise<ServerActionResult<ExecuteDepartureResult>> {
	return runDepartureCommand({
		name: "offboardEmployeeNow",
		input,
		schema: offboardNowSchema,
		run: (commands, actor, data) => commands.offboardNow(actor, data),
	});
}

export async function rehireEmployeeAction(
	input: unknown,
): Promise<ServerActionResult<{ employmentPeriodId: string }>> {
	return runDepartureCommand({
		name: "rehireEmployee",
		input,
		schema: rehireEmployeeSchema,
		run: (commands, actor, data) => commands.rehireEmployee(actor, data),
	});
}
