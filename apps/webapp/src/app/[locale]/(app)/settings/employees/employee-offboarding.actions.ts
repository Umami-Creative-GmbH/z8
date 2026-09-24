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
	AssignDepartureReplacementError,
	type AssignDepartureReplacementErrorCode,
	DepartureCommandError,
	type DepartureCommandErrorCode,
	getDepartureCommands,
	getOffboardingFollowUp,
	getOffboardingQueries,
	ResolveDepartureReviewError,
	RetryDepartureTaskError,
} from "@/lib/employee-lifecycle";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";
import type { ExecuteDepartureResult, LifecycleActor } from "@/lib/employee-lifecycle/types";
import type {
	EmployeeDeparturePreview,
	EmployeeOffboardingView,
} from "@/lib/employee-lifecycle/view-types";
import { createLogger } from "@/lib/logger";
import {
	assignDepartureReplacementSchema,
	cancelDepartureSchema,
	employeeOffboardingViewSchema,
	offboardNowSchema,
	previewDepartureSchema,
	rehireEmployeeSchema,
	resolveDepartureReviewSchema,
	retryDepartureTaskSchema,
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

const followUpMessages = {
	actor_not_authorized: "Only organization owners and admins can resolve offboarding follow-up.",
	review_not_found: "This review no longer exists.",
	review_already_resolved: "This review was already resolved.",
	resolution_required: "Describe how the review was resolved.",
	repair_incomplete:
		"The timer is still running. Correct it through time corrections before resolving this review.",
	task_not_retryable: "Only failed follow-up work can be retried.",
	task_not_found: "This handover no longer exists.",
	task_in_progress: "This handover is being processed. Try again in a moment.",
	task_already_completed: "This handover is already complete.",
	stage_not_waiting: "This approval stage has already started. Manage it in approvals.",
	replacement_invalid: "Choose an active colleague in this organization as the replacement.",
	request_conflict: "This request was already used for different details. Please try again.",
} satisfies Record<
	| ResolveDepartureReviewError["code"]
	| RetryDepartureTaskError["code"]
	| AssignDepartureReplacementErrorCode,
	string
>;

function toFollowUpError(error: unknown, actor: LifecycleActor, action: string): AnyAppError {
	if (
		error instanceof ResolveDepartureReviewError ||
		error instanceof RetryDepartureTaskError ||
		error instanceof AssignDepartureReplacementError
	) {
		const message = followUpMessages[error.code];
		if (error.code === "actor_not_authorized") {
			return new AuthorizationError({
				message,
				userId: actor.userId,
				resource: "employee",
				action,
			});
		}
		return new ValidationError({ message, field: error.code });
	}
	return new DatabaseError({
		message: "Offboarding follow-up could not be saved. Please try again.",
		operation: action,
		cause: error,
	});
}

/**
 * Follow-up of existing departures stays resolvable regardless of the release
 * gate. Authority is re-checked by each command inside its transaction.
 */
function runFollowUpCommand<TInput, TResult>(options: {
	name: string;
	input: unknown;
	schema: ZodType<TInput>;
	run: (actor: LifecycleActor, input: TInput) => Promise<TResult>;
}): Promise<ServerActionResult<TResult>> {
	return runTracedEmployeeAction({
		name: options.name,
		logError: (error) => {
			logger.error({ error }, `Failed to ${options.name}`);
		},
		execute: () =>
			Effect.gen(function* (_) {
				const actorContext = yield* _(
					getEmployeeSettingsActorContext({ queryName: `${options.name}:actor` }),
				);
				yield* _(
					requireOrgAdminEmployeeSettingsAccess(actorContext, {
						message: followUpMessages.actor_not_authorized,
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
						try: () => options.run(actor, input),
						catch: (error) => toFollowUpError(error, actor, options.name),
					}),
				);
				revalidateEmployeesCache(actor.organizationId);
				return result;
			}),
	});
}

/**
 * The lifecycle view for the employee detail page. Managers of the employee
 * get a read-only view; commands are only offered once the release gate opens.
 */
export async function getEmployeeOffboardingViewAction(
	input: unknown,
): Promise<ServerActionResult<EmployeeOffboardingView>> {
	return runTracedEmployeeAction({
		name: "getEmployeeOffboardingView",
		logError: (error) => {
			logger.error({ error }, "Failed to load employee offboarding view");
		},
		execute: () =>
			Effect.gen(function* (_) {
				const actorContext = yield* _(
					getEmployeeSettingsActorContext({ queryName: "getEmployeeOffboardingView:actor" }),
				);
				const { employeeId } = yield* _(validateInput(employeeOffboardingViewSchema, input));
				const result = yield* _(
					Effect.tryPromise({
						try: () =>
							getOffboardingQueries().view({
								organizationId: actorContext.organizationId,
								employeeId,
								actorUserId: actorContext.session.user.id,
							}),
						catch: (cause) =>
							new DatabaseError({
								message: "Employee offboarding could not be loaded.",
								operation: "getEmployeeOffboardingView",
								cause,
							}),
					}),
				);
				if (result.kind === "not_found") {
					return yield* _(
						Effect.fail(
							new NotFoundError({ message: "Employee not found.", entityType: "employee" }),
						),
					);
				}
				if (result.kind === "forbidden") {
					return yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "You cannot view this employee's offboarding.",
								userId: actorContext.session.user.id,
								resource: "employee",
								action: "getEmployeeOffboardingView",
							}),
						),
					);
				}
				if (EMPLOYEE_OFFBOARDING_RELEASE_READY) return result.view;
				return {
					...result.view,
					capabilities: {
						...result.view.capabilities,
						schedule: false,
						cancel: false,
						offboardNow: false,
						rehire: false,
					},
				};
			}),
	});
}

/** Advisory, side-effect free; the command recomputes the cutoff on submit. */
export async function previewEmployeeDepartureAction(
	input: unknown,
): Promise<ServerActionResult<EmployeeDeparturePreview>> {
	return runDepartureCommand({
		name: "previewEmployeeDeparture",
		input,
		schema: previewDepartureSchema,
		run: async (_commands, actor, data) => {
			const result = await getOffboardingQueries().preview({
				organizationId: actor.organizationId,
				employeeId: data.employeeId,
				actorUserId: actor.userId,
				lastWorkingDay: data.lastWorkingDay,
				replacementEmployeeId: data.replacementEmployeeId,
			});
			if (result.kind === "ok") return result.preview;
			if (result.kind === "invalid") throw new DepartureCommandError(result.code);
			throw new DepartureCommandError(
				result.kind === "not_found" ? "employee_not_found" : "actor_not_authorized",
			);
		},
	});
}

export async function resolveDepartureReviewAction(
	input: unknown,
): Promise<ServerActionResult<void>> {
	return runFollowUpCommand({
		name: "resolveDepartureReview",
		input,
		schema: resolveDepartureReviewSchema,
		run: (actor, data) => getOffboardingFollowUp().resolveReview(actor, data),
	});
}

export async function retryDepartureTaskAction(input: unknown): Promise<ServerActionResult<void>> {
	return runFollowUpCommand({
		name: "retryDepartureTask",
		input,
		schema: retryDepartureTaskSchema,
		run: (actor, data) => getOffboardingFollowUp().retryTask(actor, data),
	});
}

export async function assignDepartureReplacementAction(
	input: unknown,
): Promise<ServerActionResult<void>> {
	return runFollowUpCommand({
		name: "assignDepartureReplacement",
		input,
		schema: assignDepartureReplacementSchema,
		run: (actor, data) => getOffboardingFollowUp().assignReplacement(actor, data),
	});
}
