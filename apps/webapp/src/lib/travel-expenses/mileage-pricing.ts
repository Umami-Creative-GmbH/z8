import type { db as appDb } from "@/db";
import type { travelExpenseReportItem } from "@/db/schema";
import type { AllowanceOverride } from "./allowance-override";
import { loadActiveAllowanceOverrides } from "./allowance-override-read";
import { loadMileagePolicyVersions } from "./allowance-policy-store";
import {
	calculateMileageItem,
	type MileageCalculation,
	type MileagePolicyResolution,
	type MileagePolicyVersion,
	resolveMileagePolicy,
} from "./mileage";

/**
 * Prices mileage items (#606) for reads. A draft is priced with the policy
 * effective on its date today; a submitted item keeps the version stamped on
 * it at submission, so lists and pages show what was submitted.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export type MileagePricingRow = Pick<
	typeof travelExpenseReportItem.$inferSelect,
	"type" | "expenseDate" | "mileageDistanceKm" | "mileageVehicle" | "mileagePolicy"
>;

export type MileagePricer = (
	row: MileagePricingRow,
	context: { reimbursementCurrency: string; useStamp: boolean },
) => MileageCalculation;

export function mileagePricer(versions: readonly MileagePolicyVersion[]): MileagePricer {
	return (row, context) => {
		const { expenseDate, mileageDistanceKm: distanceKm, mileageVehicle: vehicle } = row;
		const stamp = row.mileagePolicy;
		let resolution: MileagePolicyResolution | null = null;
		if (context.useStamp && stamp) {
			resolution =
				stamp.expenseDate === expenseDate && stamp.vehicle === vehicle
					? { status: "found", policy: stamp }
					: null;
		} else if (expenseDate && vehicle) {
			resolution = resolveMileagePolicy(versions, expenseDate, vehicle);
		}
		return calculateMileageItem(
			{ expenseDate, distanceKm, vehicle },
			resolution,
			context.reimbursementCurrency,
		);
	};
}

/** The active administrator overrides (#610) of the mileage items among `rows`, by item ID. */
export function loadMileageOverrides(
	database: Reader,
	organizationId: string,
	rows: readonly Pick<typeof travelExpenseReportItem.$inferSelect, "id" | "type">[],
): Promise<Map<string, AllowanceOverride>> {
	return loadActiveAllowanceOverrides(database, {
		organizationId,
		itemIds: rows.filter((row) => row.type === "mileage").map((row) => row.id),
	});
}

/** A pricer with the organization's active policy versions, read only when needed. */
export async function loadMileagePricer(
	database: Reader,
	organizationId: string,
	rows: readonly Pick<MileagePricingRow, "type">[],
): Promise<MileagePricer> {
	const needed = rows.some((row) => row.type === "mileage");
	return mileagePricer(needed ? await loadMileagePolicyVersions(database, organizationId) : []);
}
