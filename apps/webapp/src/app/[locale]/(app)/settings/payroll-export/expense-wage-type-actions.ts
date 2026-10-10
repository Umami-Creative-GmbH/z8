"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	getExpenseWageTypeMappings,
	saveExpenseWageTypeMapping,
} from "@/lib/payroll-export/expense-wage-type";
import type {
	ExpenseWageTypeCodes,
	ExpenseWageTypeMapping,
} from "@/lib/payroll-export/expense-wage-type.types";
import { requireExpenseAdministrator } from "@/lib/travel-expenses/expense-administrator";
import type { PayrollLineKind } from "@/lib/travel-expenses/payroll-line-kind";
import { getReimbursementChannel } from "@/lib/travel-expenses/reimbursement-channel";
import type { ReimbursementChannel } from "@/lib/travel-expenses/reimbursement-channel.types";

/**
 * Expense wage types on the payroll export settings (#851). Only organization
 * administrators (owners and admins) read or change them. The section shows only
 * while the organization pays reimbursements through the payroll run; the
 * mappings are kept when it pays by bank transfer.
 */

export interface ExpenseWageTypeSetting {
	channel: ReimbursementChannel;
	mappings: ExpenseWageTypeMapping[];
}

export async function getExpenseWageTypeSetting(): Promise<
	ServerActionResult<ExpenseWageTypeSetting>
> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const [channel, mappings] = await Promise.all([
			getReimbursementChannel(admin.organizationId, { database: db }),
			getExpenseWageTypeMappings(admin.organizationId, { database: db }),
		]);
		return { success: true, data: { channel, mappings } };
	} catch (error) {
		logger.error({ error }, "Failed to load the expense wage types");
		return { success: false, error: "Failed to load the expense wage types" };
	}
}

export async function saveExpenseWageTypeSetting(input: {
	kind: PayrollLineKind;
	codes: ExpenseWageTypeCodes;
}): Promise<ServerActionResult<ExpenseWageTypeMapping>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const result = await saveExpenseWageTypeMapping(
			{
				organizationId: admin.organizationId,
				actorUserId: admin.userId,
				kind: input?.kind,
				codes: input?.codes,
			},
			{ database: db },
		);
		if (result.status === "invalid") {
			return { success: false, error: "Invalid wage type mapping" };
		}
		if (result.status === "saved") revalidatePath("/settings/payroll-export");
		return { success: true, data: result.mapping };
	} catch (error) {
		logger.error({ error }, "Failed to save the expense wage type");
		return { success: false, error: "Failed to save the expense wage type" };
	}
}
