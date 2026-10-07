import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";
import { reportItemTitle } from "./travel-expense-report-item-title";

/**
 * Review presentation of audited allowance overrides (#610): the reviewer
 * sees, from the frozen revision only, that an expense administrator set an
 * allowance manually, why, on what evidence and calculation, for which facts,
 * and the ordinary policy result when one existed. Called out once for the
 * report and conspicuous on the expense itself.
 */

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

const SITUATIONS: Record<string, ApprovalInboxLocalizedText> = {
	missing_coverage: text(
		"approvals:approvals.evidence.allowanceSituationMissingCoverage",
		"No organization policy covers it",
	),
	unsupported_case: text(
		"approvals:approvals.evidence.allowanceSituationUnsupported",
		"Not covered by the supported calculation rules",
	),
	official_fallback: text(
		"approvals:approvals.evidence.allowanceSituationFallback",
		"Calculated with an official fallback rate",
	),
};

type Override = NonNullable<TravelExpenseReportSubmittedItem["allowanceOverride"]>;

function factsLine(override: Override): string {
	const { scope } = override;
	if (scope.kind === "mileage") {
		// Entered values as frozen; `km` is the unit symbol, not a translatable word.
		return [scope.route, scope.distanceKm ? `${scope.distanceKm} km` : null, scope.vehicle]
			.filter(Boolean)
			.join(", ");
	}
	const { itinerary } = scope;
	const at = (date: string | null, time: string | null, zone: string | null) =>
		[date, time, zone ? `(${zone})` : null].filter(Boolean).join(" ");
	const places = scope.destinations
		.map((destination) => `${destination.place} (${destination.countryCode})`)
		.join("; ");
	return [
		`${at(itinerary.startDate, itinerary.startTime, itinerary.startTimeZone)} – ${at(itinerary.endDate, itinerary.endTime, itinerary.endTimeZone)}`,
		places,
	]
		.filter(Boolean)
		.join(", ");
}

function ordinaryResult(item: TravelExpenseReportSubmittedItem): Row["value"] {
	const ordinary = item.mileage ?? item.perDiem;
	return ordinary
		? { kind: "money", amount: ordinary.amount, currency: ordinary.currency }
		: text("approvals:approvals.evidence.allowanceNoOrdinaryResult", "No ordinary policy result");
}

/** Rows of an expense whose allowance was set manually; none otherwise. */
export function allowanceOverrideReviewRows(item: TravelExpenseReportSubmittedItem): Row[] {
	const override = item.allowanceOverride;
	if (!override) return [];
	const rows: Row[] = [
		{
			label: text("approvals:approvals.evidence.allowanceOverrideAmount", "Manually set allowance"),
			value: { kind: "money", amount: override.amount, currency: override.currency },
		},
		{
			label: text(
				"approvals:approvals.evidence.allowanceOverrideSituation",
				"Why it was not calculated",
			),
			value: SITUATIONS[override.situation.kind] ?? override.situation.kind,
		},
		{
			label: text("approvals:approvals.evidence.allowanceOverrideReason", "Reason"),
			value: override.reason,
		},
		{
			label: text("approvals:approvals.evidence.allowanceOverrideEvidence", "Evidence"),
			value: override.evidence,
		},
		{
			label: text("approvals:approvals.evidence.allowanceOverrideBasis", "Calculation basis"),
			value: override.calculationBasis,
		},
		{
			label: text("approvals:approvals.evidence.allowanceOverrideFacts", "Entered facts"),
			value: factsLine(override),
		},
		{
			label: text("approvals:approvals.evidence.allowanceOrdinaryResult", "Ordinary policy result"),
			value: ordinaryResult(item),
		},
		{
			label: text("approvals:approvals.evidence.allowanceOverrideAuthorizedBy", "Authorized by"),
			value: text("approvals:approvals.evidence.allowanceOverrideAuthorization", "{name}, {at}", {
				name: override.authorizedBy.name,
				at: { kind: "instant", at: override.authorizedAt },
			}),
		},
	];
	return rows.map((row) => ({ ...row, tone: "warning" }));
}

/** One callout naming every manually set allowance; none without overrides. */
export function allowanceOverrideReviewSections(
	facts: Pick<TravelExpenseReportSubmittedFacts, "items">,
): ApprovalInboxDetailSection[] {
	const overridden = facts.items.flatMap((item, index): ApprovalInboxLocalizedText[] =>
		item.allowanceOverride
			? [
					text("approvals:approvals.evidence.allowanceOverrideCalloutItem", "{item} ({amount})", {
						item: reportItemTitle(item, index),
						amount: {
							kind: "money",
							amount: item.allowanceOverride.amount,
							currency: item.allowanceOverride.currency,
						},
					}),
				]
			: [],
	);
	if (overridden.length === 0) return [];
	return [
		{
			type: "callout",
			title: text(
				"approvals:approvals.evidence.allowanceOverrideCalloutTitle",
				"Allowances set manually",
			),
			body: {
				...text(
					"approvals:approvals.evidence.allowanceOverrideCalloutBody",
					"An expense administrator set these allowances manually instead of the calculated amount: {items}. Check the reason and evidence before deciding.",
				),
				params: { items: overridden },
			},
			tone: "warning",
		},
	];
}
