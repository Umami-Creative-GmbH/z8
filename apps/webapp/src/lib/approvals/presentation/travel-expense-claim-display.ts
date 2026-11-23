import { parsePlainDate } from "@/lib/datetime/temporal-core";
import type { ApprovalDisplayMetadata } from "../domain/types";
import type { ApprovalInboxLocalizedText, ApprovalInboxTextParam } from "../inbox/types";

type ClaimType = "receipt" | "mileage" | "per_diem";

/** What an earlier expense claim's list row shows. */
export interface TravelExpenseClaimDisplayFacts {
	type: ClaimType;
	tripStartDate: string | null;
	tripEndDate: string | null;
	destinationCity: string | null;
	destinationCountry: string | null;
	calculatedCurrency: string;
	calculatedAmount: string;
	project: { name: string } | null;
}

const CLAIM_TYPES = {
	receipt: {
		icon: "receipt",
		text: { key: "approvals:approvals.claimSummary.type.receipt", fallback: "Receipt" },
	},
	mileage: {
		icon: "route",
		text: { key: "approvals:approvals.claimSummary.type.mileage", fallback: "Mileage" },
	},
	per_diem: {
		icon: "briefcase",
		text: { key: "approvals:approvals.claimSummary.type.perDiem", fallback: "Per Diem" },
	},
} as const satisfies Record<ClaimType, { icon: string; text: ApprovalInboxLocalizedText }>;

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

/** The trip's dates as entered, when both are recorded and valid (#295). */
function tripDates(startDate: string | null, endDate: string | null) {
	if (!startDate || !endDate) return null;
	try {
		return { start: parsePlainDate(startDate), end: parsePlainDate(endDate) };
	} catch {
		return null;
	}
}

/**
 * The trip's logical dates exactly as entered (#295). They never shift with the
 * server's or viewer's zone; claims created before they were recorded show no
 * date range rather than one derived from their UTC bounds.
 */
function formatTripDateRange(dates: NonNullable<ReturnType<typeof tripDates>>): string {
	const { start, end } = dates;
	const month = (date: typeof start) => MONTHS[date.month - 1];
	if (start.equals(end)) {
		return `${month(start)} ${String(start.day).padStart(2, "0")}, ${start.year}`;
	}
	if (start.year === end.year && start.month === end.month) {
		return `${month(start)} ${start.day}-${end.day}, ${end.year}`;
	}
	if (start.year === end.year) {
		return `${month(start)} ${start.day}-${month(end)} ${end.day}, ${end.year}`;
	}
	return `${month(start)} ${start.day}, ${start.year}-${month(end)} ${end.day}, ${end.year}`;
}

/**
 * An earlier expense claim's list row. The English strings serve search and logs; the
 * localized forms (#1978) carry the trip's dates, the destination country and the amount as
 * typed values the viewer's locale formats. A city is shown as entered.
 */
export function travelExpenseClaimDisplay(
	entity: TravelExpenseClaimDisplayFacts,
): ApprovalDisplayMetadata {
	const destination = entity.destinationCity ?? entity.destinationCountry ?? "Trip";
	const dates = tripDates(entity.tripStartDate, entity.tripEndDate);
	const claimType = CLAIM_TYPES[entity.type];
	const localizedDestination: ApprovalInboxTextParam =
		entity.destinationCity ??
		(entity.destinationCountry
			? { kind: "country", code: entity.destinationCountry }
			: { key: "approvals:approvals.claimSummary.trip", fallback: "Trip" });
	const subtitle: ApprovalInboxLocalizedText = dates
		? {
				key: "approvals:approvals.claimSummary.subtitle",
				fallback: "{destination} - {dates}",
				params: {
					destination: localizedDestination,
					dates: {
						kind: "plain_date_range",
						start: dates.start.toString(),
						end: dates.end.toString(),
					},
				},
			}
		: {
				key: "approvals:approvals.claimSummary.subtitleDestination",
				fallback: "{destination}",
				params: { destination: localizedDestination },
			};

	return {
		title: "Travel Expense",
		subtitle: dates ? `${destination} - ${formatTripDateRange(dates)}` : destination,
		summary: `${claimType.text.fallback} for ${entity.calculatedCurrency} ${entity.calculatedAmount}`,
		badge: entity.project ? { label: entity.project.name, color: null } : undefined,
		icon: claimType.icon,
		localized: {
			title: { key: "approvals:approvals.claimSummary.title", fallback: "Travel Expense" },
			subtitle,
			summary: {
				key: "approvals:approvals.claimSummary.summary",
				fallback: "{claimType} for {amount}",
				params: {
					claimType: claimType.text,
					amount: {
						kind: "money",
						amount: entity.calculatedAmount,
						currency: entity.calculatedCurrency,
					},
				},
			},
		},
	};
}
