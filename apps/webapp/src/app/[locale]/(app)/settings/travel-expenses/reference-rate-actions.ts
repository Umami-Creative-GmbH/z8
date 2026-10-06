"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { AuditAction, logAudit } from "@/lib/audit-logger";
import { canManageCurrentOrganizationSettings, getAuthContext } from "@/lib/auth-helpers";
import type { ServerActionResult } from "@/lib/effect/result";
import { logger } from "@/lib/logger";
import {
	REFERENCE_RATE_PROVIDERS,
	type ReferenceRateProvider,
} from "@/lib/travel-expenses/reference-rate";
import {
	loadReferenceRatePolicy,
	loadReferenceRateProviderStatus,
	type ReferenceRatePolicyView,
	type ReferenceRateProviderStatus,
} from "@/lib/travel-expenses/reference-rate-read";
import {
	approveReferenceRatePolicy,
	revokeReferenceRatePolicy,
} from "@/lib/travel-expenses/reference-rate-store";

/**
 * Expense administrator settings of #608: whether the organization approves
 * ECB reference rates as a conversion basis for foreign-currency expenses.
 * Only organization administrators (`canManageCurrentOrganizationSettings`)
 * may read or change it; the approval is scoped to their active organization.
 */

export interface ReferenceRateSettings {
	policy: ReferenceRatePolicyView | null;
	/** Fetch state of the source, shared by every organization. */
	provider: ReferenceRateProviderStatus;
}

const UNAUTHORIZED = "Unauthorized: Admin access required";

async function requireExpenseAdministrator() {
	const authContext = await getAuthContext();
	if (!authContext?.employee) return null;
	if (!(await canManageCurrentOrganizationSettings())) return null;
	return {
		organizationId: authContext.employee.organizationId,
		employeeId: authContext.employee.id,
		userId: authContext.user.id,
	};
}

export async function getReferenceRateSettings(): Promise<
	ServerActionResult<ReferenceRateSettings>
> {
	try {
		const admin = await requireExpenseAdministrator();
		if (!admin) return { success: false, error: UNAUTHORIZED };
		const [policy, provider] = await Promise.all([
			loadReferenceRatePolicy(db, admin.organizationId),
			loadReferenceRateProviderStatus(db),
		]);
		return { success: true, data: { policy, provider } };
	} catch (error) {
		logger.error({ error }, "Failed to load the reference rate settings");
		return { success: false, error: "Failed to load the reference rate settings" };
	}
}

/**
 * Approves a reference source. `acknowledged` records that the administrator
 * accepted that ECB publishes the rates for information only, with limited
 * currencies and working-day publications.
 */
export async function approveReferenceRateSource(input: {
	provider: ReferenceRateProvider;
	acknowledged: boolean;
}): Promise<ServerActionResult<{ policy: ReferenceRatePolicyView }>> {
	try {
		const admin = await requireExpenseAdministrator();
		if (!admin) return { success: false, error: UNAUTHORIZED };
		if (!REFERENCE_RATE_PROVIDERS.includes(input.provider)) {
			return { success: false, error: "Unknown reference rate source" };
		}
		if (input.acknowledged !== true) {
			return { success: false, error: "Confirm how the reference rates may be used" };
		}
		const policy = await approveReferenceRatePolicy(db, {
			organizationId: admin.organizationId,
			userId: admin.userId,
			provider: input.provider,
		});
		if (!policy) return { success: false, error: UNAUTHORIZED };
		logAudit({
			action: AuditAction.TRAVEL_EXPENSE_REFERENCE_RATE_APPROVED,
			actorId: admin.userId,
			employeeId: admin.employeeId,
			targetType: "organization",
			organizationId: admin.organizationId,
			metadata: { provider: policy.provider },
			timestamp: new Date(),
		}).catch((error) => logger.error({ error }, "Failed to log reference rate approval"));
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { policy } };
	} catch (error) {
		logger.error({ error }, "Failed to approve the reference rate source");
		return { success: false, error: "Failed to approve the reference rate source" };
	}
}

export async function revokeReferenceRateSource(): Promise<ServerActionResult<{ policy: null }>> {
	try {
		const admin = await requireExpenseAdministrator();
		if (!admin) return { success: false, error: UNAUTHORIZED };
		if (await revokeReferenceRatePolicy(db, admin.organizationId)) {
			logAudit({
				action: AuditAction.TRAVEL_EXPENSE_REFERENCE_RATE_REVOKED,
				actorId: admin.userId,
				employeeId: admin.employeeId,
				targetType: "organization",
				organizationId: admin.organizationId,
				timestamp: new Date(),
			}).catch((error) => logger.error({ error }, "Failed to log reference rate revocation"));
		}
		revalidatePath("/settings/travel-expenses");
		return { success: true, data: { policy: null } };
	} catch (error) {
		logger.error({ error }, "Failed to revoke the reference rate source");
		return { success: false, error: "Failed to revoke the reference rate source" };
	}
}
