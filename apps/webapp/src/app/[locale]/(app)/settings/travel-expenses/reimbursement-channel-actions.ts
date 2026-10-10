"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { requireExpenseAdministrator } from "@/lib/travel-expenses/expense-administrator";
import { isPayrollRunPreviewOpen } from "@/lib/travel-expenses/payroll-run-preview";
import {
	countUnconfirmedPayrollRuns,
	getReimbursementChannel,
	saveReimbursementChannel,
} from "@/lib/travel-expenses/reimbursement-channel";
import type { ReimbursementChannel } from "@/lib/travel-expenses/reimbursement-channel.types";

/**
 * The organization's reimbursement channel (#849). Only organization
 * administrators (owners and admins) read or change it; the payroll run is
 * offered only while the organization passes its preview gate.
 */

export interface ReimbursementChannelSetting {
	channel: ReimbursementChannel;
	/** Whether the organization passes the payroll run preview gate. */
	payrollRunAvailable: boolean;
	/** Payroll runs that can still be confirmed or discarded. */
	unconfirmedPayrollRuns: number;
}

/** The setting as the card shows it; a just-saved channel is not read back. */
async function readSetting(
	organizationId: string,
	savedChannel?: ReimbursementChannel,
): Promise<ReimbursementChannelSetting> {
	const [current, payrollRunAvailable, unconfirmedPayrollRuns] = await Promise.all([
		savedChannel ?? getReimbursementChannel(organizationId, { database: db }),
		isPayrollRunPreviewOpen(organizationId, { database: db }),
		countUnconfirmedPayrollRuns(organizationId, { database: db }),
	]);
	return { channel: current, payrollRunAvailable, unconfirmedPayrollRuns };
}

export async function getReimbursementChannelSetting(): Promise<
	ServerActionResult<ReimbursementChannelSetting>
> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		return { success: true, data: await readSetting(admin.organizationId) };
	} catch (error) {
		logger.error({ error }, "Failed to load the reimbursement channel");
		return { success: false, error: "Failed to load the reimbursement channel" };
	}
}

export async function saveReimbursementChannelSetting(input: {
	channel: ReimbursementChannel;
}): Promise<ServerActionResult<ReimbursementChannelSetting>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const result = await saveReimbursementChannel(
			{
				organizationId: admin.organizationId,
				actorUserId: admin.userId,
				channel: input?.channel,
			},
			{ database: db },
		);
		if (result.kind === "invalid") {
			return { success: false, error: "Invalid reimbursement channel" };
		}
		if (result.kind === "preview_closed") {
			return { success: false, error: "The payroll run is not available for this organization" };
		}
		if (result.kind === "saved") revalidatePath("/settings/travel-expenses");
		return { success: true, data: await readSetting(admin.organizationId, result.channel) };
	} catch (error) {
		logger.error({ error }, "Failed to save the reimbursement channel");
		return { success: false, error: "Failed to save the reimbursement channel" };
	}
}
