"use server";

import { systemClock } from "@/lib/datetime/temporal-core";
import { runRefusalAction } from "@/lib/effect/refusal-action";
import { requireOpeningBalanceUploader } from "@/lib/work-balance/adjustments/authorization";
import {
	commitOpeningBalanceUpload,
	previewOpeningBalanceUpload,
} from "@/lib/work-balance/adjustments/opening-balance-upload";
import {
	type BalanceAdjustmentActionResult,
	BalanceAdjustmentRefusal,
	type OpeningBalanceUploadOutcome,
} from "@/lib/work-balance/adjustments/types";
import { revalidateWorkBalancePaths } from "./work-balance-paths";

/**
 * The bulk opening balance upload (#999), offered on the employee settings
 * page to owners and admins and on the payroll Work balances page to payroll
 * grant holders. The client sends the file's text; the server parses it, so
 * the preview and the commit read the same rows. Authorization:
 * `requireOpeningBalanceUploader`, then each row's scope.
 */

export type OpeningBalanceUploadInput = { csv: string };

export async function previewOpeningBalanceUploadAction(
	input: OpeningBalanceUploadInput,
): Promise<BalanceAdjustmentActionResult<OpeningBalanceUploadOutcome>> {
	return runRefusalAction(
		"balanceAdjustments.previewOpeningBalanceUpload",
		BalanceAdjustmentRefusal,
		async (db) => {
			const { organizationId, userId, authority } = await requireOpeningBalanceUploader(db);
			return previewOpeningBalanceUpload(db, {
				organizationId,
				actorUserId: userId,
				authority,
				csv: requireCsv(input),
				now: systemClock.nowInstant(),
			});
		},
	);
}

export async function commitOpeningBalanceUploadAction(
	input: OpeningBalanceUploadInput,
): Promise<BalanceAdjustmentActionResult<OpeningBalanceUploadOutcome>> {
	return runRefusalAction(
		"balanceAdjustments.commitOpeningBalanceUpload",
		BalanceAdjustmentRefusal,
		async (db) => {
			const { organizationId, userId, authority } = await requireOpeningBalanceUploader(db);
			const outcome = await commitOpeningBalanceUpload(db, {
				organizationId,
				actorUserId: userId,
				authority,
				csv: requireCsv(input),
				now: systemClock.nowInstant(),
			});
			if (outcome.status === "committed") {
				revalidateWorkBalancePaths(outcome.rows.flatMap((row) => (row.employee ? [row.employee.id] : [])));
			}
			return outcome;
		},
	);
}

function requireCsv(input: OpeningBalanceUploadInput): string {
	if (typeof input?.csv !== "string") {
		throw new BalanceAdjustmentRefusal("invalid_input", "The file could not be read");
	}
	return input.csv;
}
