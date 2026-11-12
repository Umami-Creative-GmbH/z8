"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { dismissWorkingWeekNotice } from "@/lib/absences/working-week-notice-store";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

/**
 * Dismisses the one-time list of employees whose 2026 allowance the working-week conversion
 * reduces (Absences ADR 0003), for every owner and admin of the organization, for good. Managers
 * and employees are refused.
 */
export const dismissWorkingWeekNoticeAction = organizationAction(
	{ name: "vacation.dismissWorkingWeekNotice", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("workingWeekNotice.dismiss", () =>
				dismissWorkingWeekNotice(dbService.db, { organizationId, actorUserId: actor.userId }),
			);

			revalidatePath("/settings/vacation");
			revalidatePath("/settings/vacation/employees");
		}),
);