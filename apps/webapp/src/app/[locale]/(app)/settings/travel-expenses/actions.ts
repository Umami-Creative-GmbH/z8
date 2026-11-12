"use server";

import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { travelExpensePolicy } from "@/db/schema";
import { noInput, organizationAction } from "@/lib/organization-action/organization-action";
import { expenseStore } from "./expense-settings-effects";

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

/**
 * The column is a timestamp without zone that the legacy dialog wrote as a
 * day start; the driver reads its wall clock as UTC, so the UTC date part is
 * the stored calendar date.
 */
function storedDate(value: Date): string {
	return value.toISOString().slice(0, 10);
}

export const getTravelExpensePolicies = organizationAction(
	{ name: "travelExpenses.getLegacyPolicies", requires: "orgAdmin", schema: noInput },
	({ organizationId }) =>
		Effect.gen(function* () {
			const policies = yield* expenseStore(
				"travelExpenses.getLegacyPolicies",
				"Failed to fetch travel expense policies",
				(database) =>
					database.query.travelExpensePolicy.findMany({
						where: eq(travelExpensePolicy.organizationId, organizationId),
						orderBy: [desc(travelExpensePolicy.effectiveFrom)],
					}),
			);
			return policies.map(
				(policy): LegacyTravelExpensePolicyView => ({
					id: policy.id,
					effectiveFrom: storedDate(policy.effectiveFrom),
					effectiveTo: policy.effectiveTo ? storedDate(policy.effectiveTo) : null,
					currency: policy.currency,
					mileageRatePerKm: policy.mileageRatePerKm,
					perDiemRatePerDay: policy.perDiemRatePerDay,
					isActive: policy.isActive,
				}),
			);
		}),
);
