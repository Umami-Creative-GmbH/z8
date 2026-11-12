"use server";
import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { storeStep } from "@/lib/organization-action/store-step";
import {
	commitEmployeeTrackingDate,
	loadEmployeeTrackingDateSettings,
	previewEmployeeTrackingDate,
} from "@/lib/time-tracking/employee-tracking-date";
import { refreshTrackingDateResults } from "@/lib/time-tracking/tracking-date-refresh";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";
import { loadManagedEmployee } from "./managed-employee";

const proposalSchema = z.strictObject({
	employeeId: z.uuid("Invalid employee"),
	trackingStartDate: z.string().nullable(),
});

/** The employee's tracking dates, for whoever manages them; `canManage` for org admins. */
export const getEmployeeTrackingDateAction = organizationAction(
	{
		name: "employeeTrackingDates.read",
		requires: "scopedManager",
		schema: z.uuid("Invalid employee"),
	},
	(context) =>
		Effect.gen(function* () {
			const { actor, organizationId, input: employeeId } = context;
			yield* loadManagedEmployee(context, employeeId, {
				queryName: "employeeTrackingDates.target",
			});
			const dbService = yield* DatabaseService;
			const settings = yield* dbService.query("employeeTrackingDates.settings", () =>
				loadEmployeeTrackingDateSettings(dbService.db, { organizationId, employeeId }),
			);
			return {
				...settings,
				canManage: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
			};
		}),
);

export const previewEmployeeTrackingDateAction = organizationAction(
	{ name: "employeeTrackingDates.preview", requires: "orgAdmin", schema: proposalSchema },
	({ actor, organizationId, input }) =>
		storeStep(
			"employeeTrackingDates.preview",
			(database) =>
				previewEmployeeTrackingDate(database, {
					...input,
					organizationId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
				}),
			{ refusal: TrackingDateRefusal },
		),
);

export const commitEmployeeTrackingDateAction = organizationAction(
	{
		name: "employeeTrackingDates.commit",
		requires: "orgAdmin",
		schema: proposalSchema.extend({ fingerprint: z.string(), reason: z.string() }),
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"employeeTrackingDates.commit",
			async (database) => {
				const impact = await commitEmployeeTrackingDate(database, {
					...input,
					organizationId,
					actorUserId: actor.userId,
					now: systemClock.nowInstant(),
				});
				return {
					status: "committed" as const,
					refreshPending: await refreshTrackingDateResults(organizationId, impact),
				};
			},
			{ refusal: TrackingDateRefusal },
		),
);
