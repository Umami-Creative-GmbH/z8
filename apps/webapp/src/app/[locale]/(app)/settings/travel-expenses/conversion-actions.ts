"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import { loadOrganizationReimbursementCurrency } from "@/lib/travel-expenses/conversion-read";
import {
	type AuthorizeRateResult,
	authorizeManualConversionRate,
	type ConversionAdministrator,
	clearItemConversion,
	type ForeignDraftItem,
	listForeignDraftItems,
	type RemoveConversionResult,
	saveOrganizationReimbursementCurrency,
} from "@/lib/travel-expenses/conversion-store";

/**
 * Expense administrator settings of #607: the organization's reimbursement
 * currency for new reports, and documented manual rates for foreign-currency
 * expenses of draft reports. Only organization administrators
 * (`canManageCurrentOrganizationSettings`) may use them; every read and write
 * is scoped to their active organization.
 */

async function requireExpenseAdministrator(): Promise<{ error: string } | ConversionAdministrator> {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return { error: "Unauthorized: Admin access required" };
	if (!(await canManageCurrentOrganizationSettings())) {
		return { error: "Unauthorized: Admin access required" };
	}
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}

export async function getReimbursementCurrencySetting(): Promise<
	ServerActionResult<{ currency: string }>
> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		return {
			success: true,
			data: { currency: await loadOrganizationReimbursementCurrency(db, admin.organizationId) },
		};
	} catch (error) {
		logger.error({ error }, "Failed to load the reimbursement currency");
		return { success: false, error: "Failed to load the reimbursement currency" };
	}
}

export async function saveReimbursementCurrencySetting(input: {
	currency: string;
}): Promise<ServerActionResult<{ currency: string }>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const result = await saveOrganizationReimbursementCurrency(db, {
			organizationId: admin.organizationId,
			userId: admin.userId,
			currency: String(input.currency ?? ""),
		});
		if (result.kind !== "saved") {
			return {
				success: false,
				error: "Choose a currency code with at most two decimal places, e.g. EUR",
			};
		}
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_REIMBURSEMENT_CURRENCY_UPDATED,
			actorId: admin.userId,
			employeeId: admin.employeeId,
			targetType: "organization",
			organizationId: admin.organizationId,
			metadata: { currency: result.currency },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log reimbursement currency change"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { currency: result.currency } };
	} catch (error) {
		logger.error({ error }, "Failed to save the reimbursement currency");
		return { success: false, error: "Failed to save the reimbursement currency" };
	}
}

export async function getForeignDraftExpenses(): Promise<ServerActionResult<ForeignDraftItem[]>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		return { success: true, data: await listForeignDraftItems(db, admin.organizationId) };
	} catch (error) {
		logger.error({ error }, "Failed to list foreign-currency expenses");
		return { success: false, error: "Failed to load foreign-currency expenses" };
	}
}

const itemInput = z.object({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
});

const rateInput = itemInput.extend({
	rate: z.object({
		base: z.string().max(3),
		quote: z.string().max(3),
		rate: z.string().max(40),
		rateDate: z.string().max(10),
		reason: z.string().max(2000),
		evidence: z.string().max(4000),
	}),
});

export async function authorizeManualConversionRateAction(
	input: z.input<typeof rateInput>,
): Promise<ServerActionResult<AuthorizeRateResult>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const parsed = rateInput.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid conversion rate" };
		const result = await authorizeManualConversionRate(db, admin, parsed.data);
		if (result.kind === "saved") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_CONVERSION_RECORDED,
				actorId: admin.userId,
				employeeId: admin.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: admin.organizationId,
				metadata: { itemId: parsed.data.itemId, basis: "manual_rate" },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log manual conversion rate"));
			revalidatePath("/settings/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to authorize a manual conversion rate");
		return { success: false, error: "Failed to save the conversion rate" };
	}
}

export async function clearItemConversionAction(
	input: z.input<typeof itemInput>,
): Promise<ServerActionResult<Exclude<RemoveConversionResult, { kind: "not_allowed" }>>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const parsed = itemInput.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid expense" };
		const result = await clearItemConversion(db, admin, parsed.data);
		if (result.kind === "removed") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_CONVERSION_REMOVED,
				actorId: admin.userId,
				employeeId: admin.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: admin.organizationId,
				metadata: { itemId: parsed.data.itemId },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log conversion removal"));
			revalidatePath("/settings/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to clear an item conversion");
		return { success: false, error: "Failed to remove the conversion" };
	}
}
