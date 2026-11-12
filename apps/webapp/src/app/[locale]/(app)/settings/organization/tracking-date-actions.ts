"use server";

import { Effect } from "effect";
import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { ValidationError } from "@/lib/effect/errors";
import { type DatabaseClient, DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { refreshTrackingDateResults } from "@/lib/time-tracking/tracking-date-refresh";
import {
	commitOrganizationTrackingDate,
	previewOrganizationTrackingDate,
} from "@/lib/time-tracking/tracking-date-review";
import { TrackingDateRefusal } from "@/lib/time-tracking/tracking-date-review-types";

/**
 * Runs tracking-date work in one database query. A `TrackingDateRefusal` the
 * work throws (after its transaction rolled back) fails as a `ValidationError`
 * whose `refusal` is the refusal's code (`invalid_input`, `stale_preview`,
 * `blocked`), so the client can tell them apart.
 */
function trackingDateWork<T>(name: string, work: (database: DatabaseClient) => Promise<T>) {
	return Effect.gen(function* () {
		const dbService = yield* DatabaseService;
		const outcome = yield* dbService.query(name, () =>
			work(dbService.db).then(
				(data) => ({ refusal: null, data }),
				(error: unknown) => {
					if (error instanceof TrackingDateRefusal) return { refusal: error, data: null };
					throw error;
				},
			),
		);
		if (outcome.refusal) {
			return yield* Effect.fail(
				new ValidationError({ message: outcome.refusal.message, refusal: outcome.refusal.code }),
			);
		}
		return outcome.data as T;
	});
}

/** Previews what moving the organization's tracking start date changes. Org admins only. */
export const previewOrganizationTrackingDateAction = organizationAction(
	{
		name: "trackingDates.preview",
		requires: "orgAdmin",
		schema: z.strictObject({ trackingStartDate: z.string() }),
	},
	({ actor, organizationId, input }) =>
		trackingDateWork("trackingDates.preview", (database) =>
			previewOrganizationTrackingDate(database, {
				...input,
				organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
			}),
		),
);

/** Commits a reviewed tracking start date, then refreshes the results it changed. Org admins only. */
export const commitOrganizationTrackingDateAction = organizationAction(
	{
		name: "trackingDates.commit",
		requires: "orgAdmin",
		// The review checks the fingerprint and reason and refuses with `invalid_input`.
		schema: z.strictObject({
			trackingStartDate: z.string(),
			fingerprint: z.string(),
			reason: z.string(),
		}),
	},
	({ actor, organizationId, input }) =>
		trackingDateWork("trackingDates.commit", async (database) => {
			const impact = await commitOrganizationTrackingDate(database, {
				...input,
				organizationId,
				actorUserId: actor.userId,
				now: systemClock.nowInstant(),
			});
			const refreshPending = await refreshTrackingDateResults(organizationId, impact);
			return { status: "committed" as const, refreshPending };
		}),
);
