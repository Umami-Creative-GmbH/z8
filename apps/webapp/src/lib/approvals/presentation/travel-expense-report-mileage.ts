import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (
	key: string,
	fallback: string,
	params?: ApprovalInboxLocalizedText["params"],
): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
	...(params ? { params } : {}),
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
		{
			label: text("mileageDistance", "Distance"),
			value: text("mileageDistanceValue", "{distance} km", { distance: mileage.distanceKm }),
		},
		{
			label: text("mileageVehicle", "Vehicle"),
			value:
				mileage.vehicle === "car"
					? text("mileageVehicleCar", "Car")
					: text("mileageVehicleOther", "Other motor vehicle"),
		},
		{
			label: text("mileageCalculation", "Calculation"),
			value: text(
				"mileageCalculationValue",
				"{distance} km × {rate} {currency}/km = {exact} → {amount} {currency} ({rounding})",
				{
					distance: mileage.distanceKm,
					rate: mileage.ratePerKm,
					currency: mileage.currency,
					exact: mileage.exactAmount,
					amount: mileage.amount,
					rounding:
						mileage.rounding === "half_up"
							? text("mileageRoundingHalfUp", "rounded half up")
							: text("mileageRoundingHalfEven", "rounded half to even"),
				},
			),
		},
		{
			label: text("mileagePolicy", "Applied rate"),
			value: text("mileagePolicyValue", "Version {version}, valid from {from}", {
				version: policy.versionId,
				from: policy.effectiveFrom,
			}),
		},
		{
			label: text("mileagePolicySource", "Rate source"),
			value:
				policy.source.kind === "statutory_default"
					? text("mileagePolicySourceStatutory", "Statutory default: {source}", {
							source: source ?? "",
						})
					: source
						? text("mileagePolicySourceOrganizationNamed", "Organization policy: {source}", {
								source,
							})
						: text("mileagePolicySourceOrganization", "Organization policy"),
		},
	];
}
