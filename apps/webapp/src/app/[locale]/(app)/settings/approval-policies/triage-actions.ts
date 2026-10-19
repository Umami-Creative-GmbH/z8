"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
	type ApprovalTriagePolicy,
	getEffectiveApprovalTriagePolicy,
} from "@/lib/approvals/triage-policy";
import { saveApprovalTriageSettings } from "@/lib/approvals/triage-settings";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";

export async function getApprovalTriageSettingsAction(): Promise<
	ServerActionResult<ApprovalTriagePolicy>
> {
	try {
		const context = await getCurrentSettingsRouteContext();
		const organizationId = context?.authContext.session.activeOrganizationId;
		if (!organizationId || context?.accessTier !== "orgAdmin")
			return {
				success: false,
				error: "Only organization admins can read approval triage settings.",
			};
		return {
			success: true,
			data: await getEffectiveApprovalTriagePolicy({ organizationId }),
		};
	} catch (error) {
		logger.error({ error }, "Failed to read approval triage settings");
		return {
			success: false,
			error: "Unable to load approval triage settings. Please try again.",
		};
	}
}

export async function saveApprovalTriageSettingsAction(
	input: unknown,
): Promise<ServerActionResult<ApprovalTriagePolicy>> {
	try {
		const context = await getCurrentSettingsRouteContext();
		const organizationId = context?.authContext.session.activeOrganizationId;
		if (!organizationId || context?.accessTier !== "orgAdmin")
			return {
				success: false,
				error: "Only organization admins can change approval triage settings.",
			};
		if (
			!input ||
			typeof input !== "object" ||
			!("staleAfterHours" in input) ||
			!("smallCorrectionMinutes" in input)
		)
			return {
				success: false,
				error: "Provide both approval triage thresholds.",
			};
		if (
			typeof input.staleAfterHours !== "number" ||
			!Number.isInteger(input.staleAfterHours) ||
			input.staleAfterHours < 1 ||
			input.staleAfterHours > 720
		)
			return {
				success: false,
				error: "Stale age must be a whole number from 1 to 720 hours.",
			};
		if (
			typeof input.smallCorrectionMinutes !== "number" ||
			!Number.isInteger(input.smallCorrectionMinutes) ||
			input.smallCorrectionMinutes < 0 ||
			input.smallCorrectionMinutes > 60
		)
			return {
				success: false,
				error: "Small correction must be a whole number from 0 to 60 minutes.",
			};
		const data = await saveApprovalTriageSettings(db, {
			organizationId,
			actorUserId: context.authContext.user.id,
			staleAfterHours: input.staleAfterHours,
			smallCorrectionMinutes: input.smallCorrectionMinutes,
		});
		revalidatePath("/[locale]/(app)/settings/approval-policies", "page");
		revalidatePath("/[locale]/(app)/approvals", "page");
		revalidatePath("/[locale]/(app)/approvals/inbox", "page");
		return { success: true, data };
	} catch (error) {
		logger.error({ error }, "Failed to save approval triage settings");
		return {
			success: false,
			error: "Unable to save approval triage settings. Please try again.",
		};
	}
}
