import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

/**
 * Review rows of a frozen mileage item (#606): the entered trip, the applied
 * policy version with its source, and the exact calculation. Read from the
 * frozen facts only; today's policy is never consulted.
 */
export function mileageReviewRows(item: TravelExpenseReportSubmittedItem): Row[] {
	const { mileage } = item;
	if (!mileage) return [];
	const { policy } = mileage;
	const source =
		policy.source.kind === "statutory_default"
			? `${policy.source.reference ?? ""} (${policy.source.version ?? ""})`
			: [policy.source.reference, policy.source.version].filter(Boolean).join(", ") || null;
	return [
		{ label: text("mileageRoute", "Route"), value: mileage.route },
		{ label: text("mileageDistance", "Distance"), value: `${mileage.distanceKm} km` },
		{
			label: text("mileageVehicle", "Vehicle"),
			value:
				mileage.vehicle === "car"
					? text("mileageVehicleCar", "Car")
					: text("mileageVehicleOther", "Other motor vehicle"),
		},
		{
			label: text("mileageCalculation", "Calculation"),
			value: `${mileage.distanceKm} km × ${mileage.ratePerKm} ${mileage.currency}/km = ${mileage.exactAmount} → ${mileage.amount} ${mileage.currency} (${mileage.rounding === "half_up" ? "rounded half up" : "rounded half to even"})`,
		},
		{
			label: text("mileagePolicy", "Applied rate"),
			value: `Version ${policy.versionId}, valid from ${policy.effectiveFrom}`,
		},
		{
			label: text("mileagePolicySource", "Rate source"),
			value:
				policy.source.kind === "statutory_default"
					? `Statutory default: ${source}`
					: source
						? `Organization policy: ${source}`
						: text("mileagePolicySourceOrganization", "Organization policy"),
		},
	];
}
