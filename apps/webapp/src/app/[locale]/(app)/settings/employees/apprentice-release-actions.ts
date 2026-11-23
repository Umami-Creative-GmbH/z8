"use server";

import { Effect } from "effect";
import { z } from "zod";
import { apprenticeReleaseKinds } from "@/db/schema";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import {
	noInput,
	type OrganizationActor,
	organizationAction,
} from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	type ApprenticeReleaseCredits,
	loadApprenticeReleaseCredits,
	recordApprenticeReleaseWithCredit,
	voidApprenticeReleaseWithCredit,
} from "@/lib/statutory/apprenticeship/release-credit-view";
import { loadEmployeeInOrganization } from "@/lib/statutory/employee-scope";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";

// Apprentice school and exam release days (#1993, BBiG § 15 / JArbSchG § 9). Org admins record
// and void them; the employee's managers and the employee themself read the credits. Release
// credits are minutes and days only, so every allowed reader gets the same wage-free view.

const employeeId = z.uuid("Invalid selection.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const wallTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const recordSchema = z.strictObject({
	employeeId,
	releaseKind: z.enum(apprenticeReleaseKinds),
	startsOn: isoDate,
	endsOn: isoDate,
	lessonCount: z.number().int().min(0).max(20).nullable().optional(),
	schoolMinutes: z.number().int().min(0).max(10_080).nullable().optional(),
	examStartTime: wallTime.nullable().optional(),
	examEndTime: wallTime.nullable().optional(),
	schoolStartTime: wallTime.nullable().optional(),
	schoolEndTime: wallTime.nullable().optional(),
	note: z.string().max(500).nullable().optional(),
	includePreExamDay: z.boolean().optional(),
});

const voidSchema = z.strictObject({
	employeeId,
	releaseId: z.uuid("Invalid selection."),
	reason: z.string().max(500),
});

export type RecordApprenticeReleaseInput = z.input<typeof recordSchema>;

function loadCredits(organizationId: string, subjectEmployeeId: string) {
	return storeStep("apprenticeRelease.credits", async (db): Promise<ApprenticeReleaseCredits> => {
		await loadEmployeeInOrganization(db, { organizationId, employeeId: subjectEmployeeId });
		const timezone = await loadOrganizationTimezone(db, organizationId);
		return loadApprenticeReleaseCredits(db, {
			organizationId,
			employeeId: subjectEmployeeId,
			today: plainDateAt(systemClock.nowInstant(), timezone).toString(),
		});
	});
}

function refuseUnlessManaged(actor: OrganizationActor, subjectEmployeeId: string) {
	return Effect.gen(function* () {
		const scope = yield* actor.managedScope();
		yield* refuseUnless(scope.organizationWide || scope.employeeIds.has(subjectEmployeeId), {
			userId: actor.userId,
			message: "You can only view release days of employees you manage",
			resource: "apprentice_release",
			action: "read",
		});
	});
}

/** An employee's release days and credits, for org admins and the employee's managers. */
export const getApprenticeReleaseCreditsAction = organizationAction(
	{
		name: "apprenticeRelease.list",
		requires: "scopedManager",
		schema: z.strictObject({ employeeId }),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* refuseUnlessManaged(actor, input.employeeId);
			return yield* loadCredits(organizationId, input.employeeId);
		}),
);

/** The signed-in employee's own release days and credits (profile self-view). */
export const getOwnApprenticeReleaseCreditsAction = organizationAction(
	{ name: "apprenticeRelease.own", requires: "member", schema: noInput },
	({ actor, organizationId }) =>
		actor.employee
			? loadCredits(organizationId, actor.employee.id)
			: Effect.succeed<ApprenticeReleaseCredits>({ isApprentice: false, releases: [] }),
);

export const recordApprenticeReleaseAction = organizationAction(
	{ name: "apprenticeRelease.record", requires: "orgAdmin", schema: recordSchema },
	({ actor, organizationId, input }) =>
		storeStep("apprenticeRelease.record", (db) =>
			recordApprenticeReleaseWithCredit(db, {
				...input,
				organizationId,
				actorUserId: actor.userId,
			}),
		),
);

export const voidApprenticeReleaseAction = organizationAction(
	{ name: "apprenticeRelease.void", requires: "orgAdmin", schema: voidSchema },
	({ actor, organizationId, input }) =>
		storeStep("apprenticeRelease.void", (db) =>
			voidApprenticeReleaseWithCredit(db, {
				organizationId,
				employeeId: input.employeeId,
				actorUserId: actor.userId,
				releaseId: input.releaseId,
				reason: input.reason,
			}),
		),
);
