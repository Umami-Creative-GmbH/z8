import type {
	TravelExpenseReportSubmittedFacts,
	TravelExpenseReportSubmittedItem,
} from "../evidence/travel-expense-report-facts";
import type { ApprovalInboxDetailSection, ApprovalInboxLocalizedText } from "../inbox/types";

/**
 * Review presentation of audited allowance overrides (#610): the reviewer
 * sees, from the frozen revision only, that an expense administrator set an
 * allowance manually, why, on what evidence and calculation, for which facts,
 * and the ordinary policy result when one existed. Called out once for the
 * report and conspicuous on the expense itself.
 */

type Row = Extract<ApprovalInboxDetailSection, { type: "key_value" }>["rows"][number];

const text = (key: string, fallback: string): ApprovalInboxLocalizedText => ({
	key: `approvals:approvals.evidence.${key}`,
	fallback,
});

const SITUATIONS: Record<string, ApprovalInboxLocalizedText> = {
	missing_coverage: text("allowanceSituationMissingCoverage", "No organization policy covers it"),
	unsupported_case: text(
		"allowanceSituationUnsupported",
		"Not covered by the supported calculation rules",
	),
	official_fallback: text(
		"allowanceSituationFallback",
		"Calculated with an official fallback rate",
	),
};

type Override = NonNullable<TravelExpenseReportSubmittedItem["allowanceOverride"]>;

function factsLine(override: Override): string {
	const { scope } = override;
	if (scope.kind === "mileage") {
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

function ordinaryResult(
	item: TravelExpenseReportSubmittedItem,
): string | ApprovalInboxLocalizedText {
	const ordinary = item.mileage ?? item.perDiem;
	return ordinary
		? `${ordinary.amount} ${ordinary.currency}`
		: text("allowanceNoOrdinaryResult", "No ordinary policy result");
}

/** Rows of an expense whose allowance was set manually; none otherwise. */
export function allowanceOverrideReviewRows(item: TravelExpenseReportSubmittedItem): Row[] {
	const override = item.allowanceOverride;
	if (!override) return [];
	const rows: Row[] = [
		{
			label: text("allowanceOverrideAmount", "Manually set allowance"),
			value: `${override.amount} ${override.currency}`,
		},
		{
			label: text("allowanceOverrideSituation", "Why it was not calculated"),
			value: SITUATIONS[override.situation.kind] ?? override.situation.kind,
		},
		{ label: text("allowanceOverrideReason", "Reason"), value: override.reason },
		{ label: text("allowanceOverrideEvidence", "Evidence"), value: override.evidence },
		{
			label: text("allowanceOverrideBasis", "Calculation basis"),
			value: override.calculationBasis,
		},
		{ label: text("allowanceOverrideFacts", "Entered facts"), value: factsLine(override) },
		{
			label: text("allowanceOrdinaryResult", "Ordinary policy result"),
			value: ordinaryResult(item),
		},
		{
			label: text("allowanceOverrideAuthorizedBy", "Authorized by"),
			value: `${override.authorizedBy.name}, ${override.authorizedAt}`,
		},
	];
	return rows.map((row) => ({ ...row, tone: "warning" }));
}

/** One callout naming every manually set allowance; none without overrides. */
export function allowanceOverrideReviewSections(
	facts: Pick<TravelExpenseReportSubmittedFacts, "items">,
): ApprovalInboxDetailSection[] {
	const overridden = facts.items.flatMap((item, index) =>
		item.allowanceOverride
			? [
					`${index + 1}. ${item.description} (${item.allowanceOverride.amount} ${item.allowanceOverride.currency})`,
				]
			: [],
	);
	if (overridden.length === 0) return [];
	return [
		{
			type: "callout",
			title: "Allowances set manually",
			body: `An expense administrator set these allowances manually instead of the calculated amount: ${overridden.join("; ")}. Check the reason and evidence before deciding.`,
			tone: "warning",
		},
	];
}
