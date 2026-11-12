"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { dismissProrationNotice } from "@/lib/absences/proration-notice-store";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";

/**
 * Dismisses the one-time list of employees whose 2026 allowance is now prorated (#1112), for
 * every owner and admin of the organization, for good. Managers and employees are refused.
 */
export const dismissProrationNoticeAction = organizationAction(
	{ name: "vacation.dismissProrationNotice", requires: "orgAdmin", schema: noInput },
	({ actor, organizationId }) =>
		Effect.gen(function* () {
			const dbService = yield* DatabaseService;
			yield* dbService.query("prorationNotice.dismiss", () =>
				dismissProrationNotice(dbService.db, { organizationId, actorUserId: actor.userId }),
			);

			revalidatePath("/settings/vacation");
			revalidatePath("/settings/vacation/employees");
		}),
);