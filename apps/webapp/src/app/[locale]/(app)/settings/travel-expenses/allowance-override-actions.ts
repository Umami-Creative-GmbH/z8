"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	type AllowanceExceptionItem,
	type AllowanceOverrideActor,
	type AuthorizeAllowanceOverrideResult,
	authorizeAllowanceOverride,
	listAllowanceExceptionItems,
	type RevokeAllowanceOverrideResult,
	revokeAllowanceOverride,
} from "@/lib/travel-expenses/allowance-override-store";
import { requireExpenseAdministrator as requireExpenseAdministratorAccess } from "@/lib/travel-expenses/expense-administrator";

/**
 * Audited allowance overrides (#610). Only an organization expense
 * administrator (who may manage the organization's settings) records or
 * revokes one, never on their own report; every read and write is scoped to
 * the active organization. An ordinary user is refused before any read.
 */

/** Overrides are attributed to the administrator's employee profile. */
async function requireExpenseAdministrator(): Promise<{ error: string } | AllowanceOverrideActor> {
	return requireExpenseAdministratorAccess({ requireEmployee: true });
}

export async function getAllowanceExceptionItems(): Promise<
	ServerActionResult<AllowanceExceptionItem[]>
> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		return { success: true, data: await listAllowanceExceptionItems(db, admin) };
	} catch (error) {
		logger.error({ error }, "Failed to list exceptional allowances");
		return { success: false, error: "Failed to load exceptional allowances" };
	}
}

const itemInput = z.strictObject({
	reportId: z.uuid(),
	itemId: z.uuid(),
	expectedVersion: z.number().int().positive(),
});

const authorizeInput = itemInput.extend({
	amount: z.string().max(40),
	reason: z.string().max(5000),
	evidence: z.string().max(5000),
	calculationBasis: z.string().max(5000),
	replacesOverrideId: z.uuid().nullish(),
});

export async function authorizeAllowanceOverrideAction(
	input: z.input<typeof authorizeInput>,
): Promise<ServerActionResult<AuthorizeAllowanceOverrideResult>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const parsed = authorizeInput.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid allowance override" };
		const { amount, reason, evidence, calculationBasis, ...target } = parsed.data;
		const result = await authorizeAllowanceOverride(db, admin, {
			...target,
			draft: { amount, reason, evidence, calculationBasis },
		});
		if (result.kind === "authorized") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_AUTHORIZED,
				actorId: admin.userId,
				employeeId: admin.employeeId,
				targetId: target.reportId,
				targetType: "approval",
				organizationId: admin.organizationId,
				metadata: {
					itemId: target.itemId,
					overrideId: result.override.id,
					kind: result.override.kind,
					amount: result.override.amount,
					currency: result.override.currency,
					situation: result.override.situation.kind,
					replacesOverrideId: target.replacesOverrideId ?? null,
				},
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log allowance override"));
			revalidatePath("/settings/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to authorize an allowance override");
		return { success: false, error: "Failed to save the allowance override" };
	}
}

const revokeInput = itemInput.extend({ overrideId: z.uuid() });

export async function revokeAllowanceOverrideAction(
	input: z.input<typeof revokeInput>,
): Promise<ServerActionResult<RevokeAllowanceOverrideResult>> {
	try {
		const admin = await requireExpenseAdministrator();
		if ("error" in admin) return { success: false, error: admin.error };
		const parsed = revokeInput.safeParse(input);
		if (!parsed.success) return { success: false, error: "Invalid allowance override" };
		const result = await revokeAllowanceOverride(db, admin, parsed.data);
		if (result.kind === "revoked") {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_ALLOWANCE_OVERRIDE_REVOKED,
				actorId: admin.userId,
				employeeId: admin.employeeId,
				targetId: parsed.data.reportId,
				targetType: "approval",
				organizationId: admin.organizationId,
				metadata: { itemId: parsed.data.itemId, overrideId: parsed.data.overrideId },
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log allowance override revocation"));
			revalidatePath("/settings/travel-expenses");
		}
		return { success: true, data: result };
	} catch (error) {
		logger.error({ error }, "Failed to revoke an allowance override");
		return { success: false, error: "Failed to revoke the allowance override" };
	}
}
