"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { dismissProrationNotice } from "@/lib/absences/proration-notice-store";
import { runServerActionSafe, type ServerActionResult } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	getEmployeeSettingsActorContext,
	requireOrgAdminEmployeeSettingsAccess,
} from "../employees/employee-action-utils";

/**
 * Dismisses the one-time list of employees whose 2026 allowance is now prorated (#1112), for
 * every owner and admin of the organization, for good. Managers and employees are refused.
 */
export async function dismissProrationNoticeAction(): Promise<ServerActionResult<void>> {
	const effect = Effect.gen(function* () {
		const actor = yield* getEmployeeSettingsActorContext({
			queryName: "prorationNotice.dismiss:actor",
		});
		yield* requireOrgAdminEmployeeSettingsAccess(actor, {
			message: "Only owners and admins can dismiss this notice",
			resource: "vacation_proration_notice",
			action: "dismiss",
		});

		const dbService = yield* DatabaseService;
		yield* dbService.query("prorationNotice.dismiss", () =>
			dismissProrationNotice(dbService.db, {
				organizationId: actor.organizationId,
				actorUserId: actor.session.user.id,
			}),
		);

		revalidatePath("/settings/vacation");
		revalidatePath("/settings/vacation/employees");
	});

	return runServerActionSafe(effect);
}
