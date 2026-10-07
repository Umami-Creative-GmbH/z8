import type { TravelExpenseReportSubmittedItem } from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (
	key: string,
	fallback: string,
	params?: ApprovalInboxLocalizedText["params"],
): ApprovalInboxLocalizedText => ({
	key,
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
		{ label: text("approvals:approvals.evidence.mileageRoute", "Route"), value: mileage.route },
		{
			label: text("approvals:approvals.evidence.mileageDistance", "Distance"),
			value: text("approvals:approvals.evidence.mileageDistanceValue", "{distance} km", {
				distance: mileage.distanceKm,
			}),
		},
		{
			label: text("approvals:approvals.evidence.mileageVehicle", "Vehicle"),
			value:
				mileage.vehicle === "car"
					? text("approvals:approvals.evidence.mileageVehicleCar", "Car")
					: text("approvals:approvals.evidence.mileageVehicleOther", "Other motor vehicle"),
		},
		{
			label: text("approvals:approvals.evidence.mileageCalculation", "Calculation"),
			value: text(
				"approvals:approvals.evidence.mileageCalculationValue",
				"{distance} km × {rate} {currency}/km = {exact} → {amount} {currency} ({rounding})",
				{
					distance: mileage.distanceKm,
					rate: mileage.ratePerKm,
					currency: mileage.currency,
					exact: mileage.exactAmount,
					amount: mileage.amount,
					rounding:
						mileage.rounding === "half_up"
							? text("approvals:approvals.evidence.mileageRoundingHalfUp", "rounded half up")
							: text(
									"approvals:approvals.evidence.mileageRoundingHalfEven",
									"rounded half to even",
								),
				},
			),
		},
		{
			label: text("approvals:approvals.evidence.mileagePolicy", "Applied rate"),
			value: text(
				"approvals:approvals.evidence.mileagePolicyValue",
				"Version {version}, valid from {from}",
				{
					version: policy.versionId,
					from: policy.effectiveFrom,
				},
			),
		},
		{
			label: text("approvals:approvals.evidence.mileagePolicySource", "Rate source"),
			value:
				policy.source.kind === "statutory_default"
					? text(
							"approvals:approvals.evidence.mileagePolicySourceStatutory",
							"Statutory default: {source}",
							{
								source: source ?? "",
							},
						)
					: source
						? text(
								"approvals:approvals.evidence.mileagePolicySourceOrganizationNamed",
								"Organization policy: {source}",
								{
									source,
								},
							)
						: text(
								"approvals:approvals.evidence.mileagePolicySourceOrganization",
								"Organization policy",
							),
		},
	];
}
