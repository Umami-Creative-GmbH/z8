import "server-only";

import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	type AssignDepartureReplacementInput,
	assignDepartureReplacement,
} from "./approval-handover";
import type { createDepartureCommands } from "./commands";
import {
	getEmployeeOffboardingView,
	previewEmployeeDeparture,
	previewPastDeparture as previewPastDepartureQuery,
} from "./queries";
import {
	getReplacementEmployeeById,
	type SearchReplacementEmployeesInput,
	searchReplacementEmployees,
} from "./replacement-search";
import { resolveDepartureReview, retryDepartureTask } from "./reviews";
import { createProductionDepartureCommands } from "./runtime";
import type {
	CorrectPastDepartureDate,
	LifecycleActor,
	RecordHistoricalDepartureDate,
	RecordPastDeparture,
} from "./types";

export { employeeHasOrganizationAccess, resolveEmployeeOrganizationAccess } from "./access";
export {
	AssignDepartureReplacementError,
	type AssignDepartureReplacementErrorCode,
} from "./approval-handover";
export {
	createDepartureCommands,
	DepartureCommandError,
	type DepartureCommandErrorCode,
} from "./commands";
export { departureCutoff, retrospectiveDepartureCutoff } from "./cutoff";
export { previewPastDeparture as previewPastDepartureWithDb } from "./queries";
export { assertEmployeeOffboardingReleased, EMPLOYEE_OFFBOARDING_RELEASE_READY } from "./release";
export {
	getReplacementEmployeeById,
	type SearchReplacementEmployeesInput,
	searchReplacementEmployees,
} from "./replacement-search";
export { inspectRetrospectiveDepartureImpact } from "./retrospective-reconciliation";
export { ResolveDepartureReviewError, RetryDepartureTaskError } from "./reviews";

/**
 * Production composition of the departure commands with the canonical
 * clock-out. Server actions check the release gate before reaching this.
 */
export function getDepartureCommands(): ReturnType<typeof createDepartureCommands> {
	return createProductionDepartureCommands();
}

/** Direct production command helpers for unified leaving-date callers (#1928, #1929, #1930). */
export function recordPastDeparture(actor: LifecycleActor, input: RecordPastDeparture) {
	return getDepartureCommands().recordPastDeparture(actor, input);
}

export function correctPastDepartureDate(actor: LifecycleActor, input: CorrectPastDepartureDate) {
	return getDepartureCommands().correctPastDepartureDate(actor, input);
}

export function recordHistoricalDepartureDate(
	actor: LifecycleActor,
	input: RecordHistoricalDepartureDate,
) {
	return getDepartureCommands().recordHistoricalDepartureDate(actor, input);
}

export function previewPastDeparture(input: {
	organizationId: string;
	employeeId: string;
	actorUserId: string;
	lastWorkingDay: string;
	replacementEmployeeId: string | null;
}) {
	return previewPastDepartureQuery(db, { ...input, now: systemClock.nowInstant() });
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
		previewPast: (input: {
			organizationId: string;
			employeeId: string;
			actorUserId: string;
			lastWorkingDay: string;
			replacementEmployeeId: string | null;
		}) => previewPastDepartureQuery(db, { ...input, now: systemClock.nowInstant() }),
		searchReplacements: (input: Omit<SearchReplacementEmployeesInput, "now">) =>
			searchReplacementEmployees(db, { ...input, now: systemClock.nowInstant() }),
		getReplacementById: (input: { organizationId: string; employeeId: string }) =>
			getReplacementEmployeeById(db, { ...input, now: systemClock.nowInstant() }),
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
				now: systemClock.nowInstant(),
			}),
		retryTask: (actor: LifecycleActor, input: { taskId: string }) =>
			retryDepartureTask(db, {
				organizationId: actor.organizationId,
				taskId: input.taskId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
			}),
		assignReplacement: (actor: LifecycleActor, input: AssignDepartureReplacementInput) =>
			assignDepartureReplacement(db, actor, input, systemClock.nowInstant()),
	};
}
