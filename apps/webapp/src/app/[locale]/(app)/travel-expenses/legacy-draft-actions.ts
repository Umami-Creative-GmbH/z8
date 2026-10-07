"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { readPrivateObject } from "@/lib/storage/export-s3-client";
import { getEffectiveTimezone } from "@/lib/timezone/effective-timezone";
import {
	type LegacyConversionView,
	loadOwnLegacyConversion,
} from "@/lib/travel-expenses/legacy-draft-conversion-read";
import {
	type ConvertLegacyDraftResult,
	convertLegacyDraft,
} from "@/lib/travel-expenses/legacy-draft-conversion-store";

/**
 * Legacy draft conversion (#616). An employee continues one of their own
 * legacy claim drafts as a single-item report; the legacy claim stays as it
 * was. Submitted and decided claims are never converted.
 */

const CLAIM_NOT_FOUND = "Travel expense claim not found";
const REPORT_NOT_FOUND = "Expense report not found";

async function currentOwner() {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}

export type ConvertLegacyDraftOutcome = Exclude<ConvertLegacyDraftResult, { kind: "not_found" }>;

export async function convertLegacyTravelExpenseDraftAction(
	claimId: string,
): Promise<ServerActionResult<ConvertLegacyDraftOutcome>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		if (!z.uuid().safeParse(claimId).success) return { success: false, error: CLAIM_NOT_FOUND };
		const result = await convertLegacyDraft(
			db,
			owner,
			{ claimId },
			{
				readObject: readPrivateObject,
				defaultTimeZone: await getEffectiveTimezone(owner.userId, owner.organizationId),
			},
		);
		if (result.kind === "not_found") return { success: false, error: CLAIM_NOT_FOUND };
		if (result.kind === "converted" && !result.replayed) {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_LEGACY_DRAFT_CONVERTED,
				actorId: owner.userId,
				employeeId: owner.employeeId,
				targetId: result.reportId,
				targetType: "approval",
				organizationId: owner.organizationId,
				metadata: { model: "report", legacyClaimId: claimId },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log a legacy draft conversion"));
			revalidatePath("/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to convert a legacy travel expense draft");
		return { success: false, error: "Failed to continue the legacy draft" };
	}
}

/**
 * The conversion behind one of the signed-in employee's reports, or of one of
 * their legacy drafts; null when there is none.
 */
export async function getLegacyTravelExpenseConversion(
	ref: { reportId: string } | { claimId: string },
): Promise<ServerActionResult<LegacyConversionView | null>> {
	try {
		const owner = await currentOwner();
		if (!owner) return { success: false, error: "Unauthorized" };
		const id = "reportId" in ref ? ref.reportId : ref.claimId;
		if (!z.uuid().safeParse(id).success) {
			return { success: false, error: "reportId" in ref ? REPORT_NOT_FOUND : CLAIM_NOT_FOUND };
		}
		return {
			success: true,
			data: await loadOwnLegacyConversion(
				db,
				owner,
				"reportId" in ref ? { reportId: id } : { claimId: id },
			),
		};
	} catch (error) {
		logger.error({ error }, "Failed to load a legacy draft conversion");
		return { success: false, error: "Failed to load the legacy draft conversion" };
	}
}
