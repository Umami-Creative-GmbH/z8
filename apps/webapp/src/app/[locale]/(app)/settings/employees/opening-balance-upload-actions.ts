"use server";

import { z } from "zod";
import { systemClock } from "@/lib/datetime/temporal-core";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access";
import { storeStep } from "@/lib/organization-action/store-step";
import { openingBalanceUploaderAuthority } from "@/lib/work-balance/adjustments/authorization";
import {
	commitOpeningBalanceUpload,
	previewOpeningBalanceUpload,
} from "@/lib/work-balance/adjustments/opening-balance-upload";
import { BalanceAdjustmentRefusal } from "@/lib/work-balance/adjustments/types";
import { revalidateWorkBalancePaths } from "./work-balance-paths";

/**
 * The bulk opening balance upload (#999), offered on the employee settings
 * page to owners and admins and on the payroll Work balances page to payroll
 * grant holders. The client sends the file's text; the server parses it, so
 * the preview and the commit read the same rows. Any org member reaches the
 * actions (#1613); `openingBalanceUploaderAuthority` decides, then each row's scope.
 */

const openingBalanceUploadSchema = z.strictObject({
	csv: z.string("The file could not be read"),
});

export type OpeningBalanceUploadInput = z.input<typeof openingBalanceUploadSchema>;

export const previewOpeningBalanceUploadAction = organizationAction(
	{
		name: "balanceAdjustments.previewOpeningBalanceUpload",
		requires: "member",
		schema: openingBalanceUploadSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"balanceAdjustments.previewOpeningBalanceUpload",
			async (db) => {
				const authority = await openingBalanceUploaderAuthority(db, {
					organizationId,
					userId: actor.userId,
					isOrgAdmin: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
				});
				return previewOpeningBalanceUpload(db, {
					organizationId,
					actorUserId: actor.userId,
					authority,
					csv: input.csv,
					now: systemClock.nowInstant(),
				});
			},
			{ refusal: BalanceAdjustmentRefusal },
		),
);

export const commitOpeningBalanceUploadAction = organizationAction(
	{
		name: "balanceAdjustments.commitOpeningBalanceUpload",
		requires: "member",
		schema: openingBalanceUploadSchema,
	},
	({ actor, organizationId, input }) =>
		storeStep(
			"balanceAdjustments.commitOpeningBalanceUpload",
			async (db) => {
				const authority = await openingBalanceUploaderAuthority(db, {
					organizationId,
					userId: actor.userId,
					isOrgAdmin: meetsSettingsAccess(actor.settingsAccess, "orgAdmin"),
				});
				const outcome = await commitOpeningBalanceUpload(db, {
					organizationId,
					actorUserId: actor.userId,
					authority,
					csv: input.csv,
					now: systemClock.nowInstant(),
				});
				if (outcome.status === "committed") {
					revalidateWorkBalancePaths(
						outcome.rows.flatMap((row) => (row.employee ? [row.employee.id] : [])),
					);
				}
				return outcome;
			},
			{ refusal: BalanceAdjustmentRefusal },
		),
);
