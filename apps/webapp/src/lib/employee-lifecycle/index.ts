import "server-only";

import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type AssignDepartureReplacementInput,
	assignDepartureReplacement,
} from "./approval-handover";
import type { createDepartureCommands } from "./commands";
import { getEmployeeOffboardingView, previewEmployeeDeparture } from "./queries";
import { resolveDepartureReview, retryDepartureTask } from "./reviews";
import { createProductionDepartureCommands } from "./runtime";
import type { LifecycleActor } from "./types";

export { employeeHasOrganizationAccess, resolveEmployeeOrganizationAccess } from "./access";
export {
	AssignDepartureReplacementError,
	type AssignDepartureReplacementErrorCode,
} from "./approval-handover";
export { DepartureCommandError, type DepartureCommandErrorCode } from "./commands";
export { assertEmployeeOffboardingReleased, EMPLOYEE_OFFBOARDING_RELEASE_READY } from "./release";
export { ResolveDepartureReviewError, RetryDepartureTaskError } from "./reviews";

/**
 * Production composition of the departure commands with the canonical
 * clock-out. Server actions check the release gate before reaching this.
 */
export function getDepartureCommands(): ReturnType<typeof createDepartureCommands> {
	return createProductionDepartureCommands();
}

/** Read-only lifecycle views at the server's current instant. */
export function getOffboardingQueries() {
	return {
		view: (input: { organizationId: string; employeeId: string; actorUserId: string }) =>
			getEmployeeOffboardingView(db, { ...input, now: systemClock.nowInstant() }),
		preview: (input: {
			organizationId: string;
			employeeId: string;
			actorUserId: string;
			lastWorkingDay: string | null;
			replacementEmployeeId: string | null;
		}) => previewEmployeeDeparture(db, { ...input, now: systemClock.nowInstant() }),
	};
}

/**
 * Admin follow-up commands. They stay available regardless of the release
 * gate, because effective departures and their reviews must remain resolvable.
 */
export function getOffboardingFollowUp() {
	return {
		resolveReview: (actor: LifecycleActor, input: { reviewId: string; resolution: string }) =>
			resolveDepartureReview(db, {
				organizationId: actor.organizationId,
				reviewId: input.reviewId,
				actorUserId: actor.userId,
				resolution: input.resolution,
				now: new Date(systemClock.nowInstant().epochMilliseconds),
			}),
		retryTask: (actor: LifecycleActor, input: { taskId: string }) =>
			retryDepartureTask(db, {
				organizationId: actor.organizationId,
				taskId: input.taskId,
				actorUserId: actor.userId,
				now: new Date(systemClock.nowInstant().epochMilliseconds),
			}),
		assignReplacement: (actor: LifecycleActor, input: AssignDepartureReplacementInput) =>
			assignDepartureReplacement(db, actor, input, systemClock.nowInstant()),
	};
}
