"use server";

import { Effect } from "effect";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveDeputyDecisionsEnabled } from "@/lib/approvals/approval-settings";
import { DatabaseError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { logger } from "@/lib/logger";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { approvalManagementRefusal } from "./approval-management";

const APPROVAL_ESCALATION_PATH = "/settings/approval-policies";

/**
 * "Deputies can decide approvals" (#1015, Approvals ADR 0002): an approval
 * setting that users who can manage approvals change, like the escalation
 * policy on the same page. Changes are audit-logged.
 */
export const saveDeputyDecisionsEnabledAction = organizationAction(
	{
		name: "approvalSettings.saveDeputyDecisionsEnabled",
		requires: "member",
		schema: z.object({ enabled: z.boolean("Invalid setting") }, "Invalid setting"),
	},
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* approvalManagementRefusal(
				actor,
				organizationId,
				"You do not have permission to manage approval settings.",
			);
			const dbService = yield* DatabaseService;
			const result = yield* dbService
				.query("approvalSettings.saveDeputyDecisionsEnabled", () =>
					saveDeputyDecisionsEnabled(dbService.db, {
						organizationId,
						enabled: input.enabled,
						actorUserId: actor.userId,
					}),
				)
				.pipe(
					Effect.mapError((error) => {
						logger.error({ error: error.cause }, "Failed to save the deputy decisions setting");
						return new DatabaseError({
							message: "Failed to save the setting",
							operation: "approvalSettings.saveDeputyDecisionsEnabled",
							cause: error.cause,
						});
					}),
				);
			revalidatePath(APPROVAL_ESCALATION_PATH);
			return { deputyDecisionsEnabled: result.deputyDecisionsEnabled };
		}),
);
