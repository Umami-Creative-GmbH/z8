"use server";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { travelExpensePolicy } from "@/db/schema";
import type { ServerActionResult } from "@/lib/effect/result";
import { requireExpenseAdministrator } from "@/lib/travel-expenses/expense-administrator";

/**
 * Legacy travel expense policies (read-only since #606). Their rates were
 * never applied by any calculation, and their non-transactional save could
 * deactivate the valid policy before a failing write, so the write path is
 * retired: dated mileage rates live in versioned allowance policies
 * (`mileage-policy-actions.ts`). Existing rows stay visible as history.
 */

export interface LegacyTravelExpensePolicyView {
	id: string;
	/** Stored calendar date (YYYY-MM-DD) of the legacy timestamp, without zone conversion. */
	effectiveFrom: string;
	effectiveTo: string | null;
	currency: string;
	mileageRatePerKm: string | null;
	perDiemRatePerDay: string | null;
	isActive: boolean;
}

const requireTravelExpenseOrgAdmin = () => requireExpenseAdministrator();

/**
 * The column is a timestamp without zone that the legacy dialog wrote as a
 * day start; the driver reads its wall clock as UTC, so the UTC date part is
 * the stored calendar date.
 */
function storedDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}

export async function getTravelExpensePolicies(): Promise<
	ServerActionResult<LegacyTravelExpensePolicyView[]>
> {
	try {
		const access = await requireTravelExpenseOrgAdmin();
		if ("error" in access) {
			return { success: false, error: access.error };
		}

		const policies = await db.query.travelExpensePolicy.findMany({
			where: eq(travelExpensePolicy.organizationId, access.organizationId),
			orderBy: [desc(travelExpensePolicy.effectiveFrom)],
		});

		return {
			success: true,
			data: policies.map((policy) => ({
				id: policy.id,
				effectiveFrom: storedDate(policy.effectiveFrom),
				effectiveTo: policy.effectiveTo ? storedDate(policy.effectiveTo) : null,
				currency: policy.currency,
				mileageRatePerKm: policy.mileageRatePerKm,
				perDiemRatePerDay: policy.perDiemRatePerDay,
				isActive: policy.isActive,
			})),
		};
	} catch (error) {
		console.error("Error fetching travel expense policies:", error);
		return { success: false, error: "Failed to fetch travel expense policies" };
	}
}
