"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	type AnyAppError,
	AuthorizationError,
	type DatabaseError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
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
import { offboardingWorkBalance } from "@/lib/employee-lifecycle/final-payout";
import { EMPLOYEE_OFFBOARDING_RELEASE_READY } from "@/lib/employee-lifecycle/release";
import type { LifecycleActor } from "@/lib/employee-lifecycle/types";
import type {
	EmployeeOffboardingState,
	OffboardingWorkBalance,
} from "@/lib/employee-lifecycle/view-types";
import { createLogger } from "@/lib/logger";
import {
	type OrganizationActionContext,
	organizationAction,
} from "@/lib/organization-action/organization-action";
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
import { mayWriteBalanceAdjustments } from "@/lib/work-balance/adjustments/authorization";
import type { WorkBalanceDbClient } from "@/lib/work-balance/db-client";
import { getEmployeeWorkBalance, loadWorkBalanceEmployee } from "@/lib/work-balance/service";
import { revalidateEmployeesCache } from "./employee-action-utils";

const logger = createLogger("EmployeeOffboardingActions");

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

function toAppError(failure: DatabaseError, actor: LifecycleActor, action: string): AnyAppError {
	const error = failure.cause;
	if (!(error instanceof DepartureCommandError)) {
		return failure;
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
	return new ValidationError({ message, field: error.code, refusal: error.code });
}

const lifecycleActorOf = (context: OrganizationActionContext<unknown>): LifecycleActor => ({
	userId: context.actor.userId,
	organizationId: context.organizationId,
});

/**
 * Runs a departure command for an org admin: the release gate, then the
 * command, whose authority over the target is re-checked under the lifecycle
 * locks.
 */
function runDepartureCommand<TResult>(
	name: string,
	context: OrganizationActionContext<unknown>,
	run: (actor: LifecycleActor) => Promise<TResult>,
) {
	return Effect.gen(function* () {
		if (!EMPLOYEE_OFFBOARDING_RELEASE_READY) {
			return yield* Effect.fail(
				new ValidationError({
					message: "Employee offboarding is not available yet.",
					field: "employeeId",
				}),
			);
		}
		const actor = lifecycleActorOf(context);
		const dbService = yield* DatabaseService;
		const result = yield* dbService
			.query(`employeeOffboarding.${name}`, () => run(actor))
			.pipe(Effect.mapError((error) => toAppError(error, actor, name)));
		revalidateEmployeesCache(actor.organizationId);
		revalidatePath("/equipment", "layout");
		revalidatePath("/my-equipment");
		revalidatePath("/settings/equipment");
		return result;
	});
}

export const scheduleEmployeeDepartureAction = organizationAction(
	{
		name: "employeeOffboarding.scheduleDeparture",
		requires: "orgAdmin",
		schema: scheduleDepartureSchema,
		addsEmployees: (input) => [input.replacementEmployeeId],
	},
	(context) =>
		runDepartureCommand("scheduleEmployeeDeparture", context, (actor) =>
			getDepartureCommands().scheduleDeparture(actor, context.input),
		),
);

export const cancelEmployeeDepartureAction = organizationAction(
	{
		name: "employeeOffboarding.cancelDeparture",
		requires: "orgAdmin",
		schema: cancelDepartureSchema,
	},
	(context) =>
		runDepartureCommand("cancelEmployeeDeparture", context, (actor) =>
			getDepartureCommands().cancelDeparture(actor, context.input),
		),
);

export const offboardEmployeeNowAction = organizationAction(
	{
		name: "employeeOffboarding.offboardNow",
		requires: "orgAdmin",
		schema: offboardNowSchema,
		addsEmployees: (input) => [input.replacementEmployeeId],
	},
	(context) =>
		runDepartureCommand("offboardEmployeeNow", context, (actor) =>
			getDepartureCommands().offboardNow(actor, context.input),
		),
);

export const rehireEmployeeAction = organizationAction(
	{
		name: "employeeOffboarding.rehire",
		requires: "orgAdmin",
		schema: rehireEmployeeSchema,
		addsEmployees: (input) => [input.primaryManagerId],
	},
	(context) =>
		runDepartureCommand("rehireEmployee", context, (actor) =>
			getDepartureCommands().rehireEmployee(actor, context.input),
		),
);

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

function toFollowUpError(
	failure: DatabaseError,
	actor: LifecycleActor,
	action: string,
): AnyAppError {
	const error = failure.cause;
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
		return new ValidationError({ message, field: error.code, refusal: error.code });
	}
	return failure;
}

/**
 * Follow-up of existing departures stays resolvable regardless of the release
 * gate. Authority is re-checked by each command inside its transaction.
 */
function runFollowUpCommand<TResult>(
	name: string,
	context: OrganizationActionContext<unknown>,
	run: (actor: LifecycleActor) => Promise<TResult>,
) {
	return Effect.gen(function* () {
		const actor = lifecycleActorOf(context);
		const dbService = yield* DatabaseService;
		const result = yield* dbService
			.query(`employeeOffboarding.${name}`, () => run(actor))
			.pipe(Effect.mapError((error) => toFollowUpError(error, actor, name)));
		revalidateEmployeesCache(actor.organizationId);
		return result;
	});
}

/**
 * The lifecycle view for the employee detail page. Managers of the employee
 * get a read-only view; commands are only offered once the release gate opens.
 */
export const getEmployeeOffboardingViewAction = organizationAction(
	{
		name: "employeeOffboarding.view",
		requires: "scopedManager",
		schema: employeeOffboardingViewSchema,
	},
	({ actor, organizationId, input: { employeeId } }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			const result = yield* dbService.query("employeeOffboarding.view", () =>
				getOffboardingQueries().view({
					organizationId,
					employeeId,
					actorUserId: actor.userId,
				}),
			);
			if (result.kind === "not_found") {
				return yield* Effect.fail(
					new NotFoundError({ message: "Employee not found.", entityType: "employee" }),
				);
			}
			if (result.kind === "forbidden") {
				return yield* Effect.fail(
					new AuthorizationError({
						message: "You cannot view this employee's offboarding.",
						userId: actor.userId,
						resource: "employee",
						action: "getEmployeeOffboardingView",
					}),
				);
			}
			if (EMPLOYEE_OFFBOARDING_RELEASE_READY) {
				// Information only: a balance that fails to load never hides the departure.
				const workBalance = yield* dbService
					.query("employeeOffboarding.workBalance", () =>
						loadOffboardingWorkBalance(dbService.db, {
							organizationId,
							employeeId,
							state: result.view.state,
						}),
					)
					.pipe(
						Effect.catch((error) =>
							Effect.sync(() => {
								logger.error({ error }, "Failed to load the offboarding work balance");
								return null;
							}),
						),
					);
				return { ...result.view, workBalance };
			}
			return {
				...result.view,
				workBalance: null,
				capabilities: {
					...result.view.capabilities,
					schedule: false,
					cancel: false,
					offboardNow: false,
					rehire: false,
				},
			};
		}),
);

/**
 * The departing employee's work balance for the review (#1002): the same
 * projection every balance view reads, and a final overtime payout when the
 * viewer may record payouts (the #993 rule, re-checked when recording).
 */
async function loadOffboardingWorkBalance(
	dbClient: WorkBalanceDbClient,
	input: {
		organizationId: string;
		employeeId: string;
		state: EmployeeOffboardingState;
	},
): Promise<OffboardingWorkBalance | null> {
	if (input.state === "active") return null;
	const scope = { organizationId: input.organizationId, employeeId: input.employeeId };
	const [subject, balance, mayRecordPayouts] = await Promise.all([
		loadWorkBalanceEmployee(scope, dbClient),
		getEmployeeWorkBalance(scope, dbClient),
		mayWriteBalanceAdjustments(dbClient, scope),
	]);
	if (!subject) return null;
	return offboardingWorkBalance({
		state: input.state,
		balance,
		mayRecordPayouts,
		today: plainDateAt(systemClock.nowInstant(), subject.timezone).toString(),
	});
}

/** Advisory, side-effect free; the command recomputes the cutoff on submit. */
export const previewEmployeeDepartureAction = organizationAction(
	{
		name: "employeeOffboarding.previewDeparture",
		requires: "orgAdmin",
		schema: previewDepartureSchema,
	},
	(context) =>
		runDepartureCommand("previewEmployeeDeparture", context, async (actor) => {
			const data = context.input;
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
		}),
);

export const resolveDepartureReviewAction = organizationAction(
	{
		name: "employeeOffboarding.resolveReview",
		requires: "orgAdmin",
		schema: resolveDepartureReviewSchema,
	},
	(context) =>
		runFollowUpCommand("resolveDepartureReview", context, (actor) =>
			getOffboardingFollowUp().resolveReview(actor, context.input),
		),
);

export const retryDepartureTaskAction = organizationAction(
	{
		name: "employeeOffboarding.retryTask",
		requires: "orgAdmin",
		schema: retryDepartureTaskSchema,
	},
	(context) =>
		runFollowUpCommand("retryDepartureTask", context, (actor) =>
			getOffboardingFollowUp().retryTask(actor, context.input),
		),
);

export const assignDepartureReplacementAction = organizationAction(
	{
		name: "employeeOffboarding.assignReplacement",
		requires: "orgAdmin",
		schema: assignDepartureReplacementSchema,
		addsEmployees: (input) => [input.replacementEmployeeId],
	},
	(context) =>
		runFollowUpCommand("assignDepartureReplacement", context, (actor) =>
			getOffboardingFollowUp().assignReplacement(actor, context.input),
		),
);
