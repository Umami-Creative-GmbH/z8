import type { ApprovalDisplayMetadata } from "@/lib/approvals/domain/types";
import type { ApprovalInboxItem, ApprovalInboxType } from "@/lib/approvals/inbox/types";
import { localizedTimeApprovalSummary } from "@/lib/approvals/presentation/time-approval-summary-text";
import { travelExpenseClaimDisplay } from "@/lib/approvals/presentation/travel-expense-claim-display";
import { travelExpenseReportDisplay } from "@/lib/approvals/presentation/travel-expense-report-display";

/**
 * List summaries that used to reach the viewer in English only (#1978), each built by the code
 * that sends it, with German translations and the texts a German viewer must see.
 */

export const GERMAN_SUMMARY_TRANSLATIONS = {
	"approvals:approvals.claimSummary.title": "Reisekosten",
	"approvals:approvals.claimSummary.summary": "{claimType} über {amount}",
	"approvals:approvals.claimSummary.type.receipt": "Beleg",
	"approvals:approvals.timeApproval.title.manualTimeSubmission": "Manuelle Zeiterfassung",
	"approvals:approvals.timeApproval.title.policyClockOut": "Ausstempel-Freigabe",
	"approvals:approvals.timeApproval.summary": "{duration} am {date}",
	"approvals:approvals.timeApproval.durationHours": "{hours} Std.",
	"approvals:approvals.timeApproval.durationMinutes": "{minutes} Min.",
	"approvals:approvals.timeApproval.badge.manual": "Manuell",
	"approvals:approvals.timeApproval.badge.clockOut": "Ausstempeln",
	"approvals:approvals.reportSummary.title": "Spesenabrechnung",
	"approvals:approvals.reportSummary.factsUnavailable": "Eingereichte Angaben nicht verfügbar",
};

/** A canonical ordinary row's summary, as `ordinary-canonical-read` builds it. */
function timeApprovalDisplay(
	kind: "manual_time_submission" | "policy_clock_out",
	durationMinutes: number,
): ApprovalDisplayMetadata {
	// 22:30 UTC is already the next day at the captured +02:00 offset.
	const localized = localizedTimeApprovalSummary({
		kind,
		clockIn: { timestamp: new Date("2026-07-19T22:30:00Z"), utcOffsetMinutes: 120 },
		startTime: "00:30",
		endTime: "08:30",
		durationMinutes,
	});
	return {
		title: kind,
		subtitle: "",
		summary: "English only",
		badge: { label: "English badge", color: null },
		localized,
	};
}

export const GERMAN_SUMMARY_CASES: Array<{
	name: string;
	type: ApprovalInboxType;
	display: ApprovalDisplayMetadata;
	title: string;
	detail: string;
	badge?: string;
}> = [
	{
		name: "an earlier expense claim",
		type: "travel_expense_claim",
		display: travelExpenseClaimDisplay({
			type: "receipt",
			tripStartDate: "2026-04-15",
			tripEndDate: "2026-04-17",
			destinationCity: "Berlin",
			destinationCountry: "DE",
			calculatedCurrency: "EUR",
			calculatedAmount: "120.50",
			project: null,
		}),
		title: "Reisekosten",
		// Testing Library matches the formatted amount's no-break space as a plain one.
		detail: "Beleg über 120,50 €",
	},
	{
		name: "a manual time submission",
		type: "time_entry",
		display: timeApprovalDisplay("manual_time_submission", 480),
		title: "Manuelle Zeiterfassung",
		detail: "8 Std. am 20.07.2026",
		badge: "Manuell",
	},
	{
		name: "a policy clock-out",
		type: "time_entry",
		display: timeApprovalDisplay("policy_clock_out", 45),
		title: "Ausstempel-Freigabe",
		detail: "45 Min. am 20.07.2026",
		badge: "Ausstempeln",
	},
	{
		name: "an expense report without its submitted facts",
		type: "travel_expense_report",
		display: travelExpenseReportDisplay(null),
		title: "Spesenabrechnung",
		detail: "Eingereichte Angaben nicht verfügbar",
	},
];

/** The inbox row of a display, as the read service maps it. */
export function inboxRowFromDisplay(
	id: string,
	type: ApprovalInboxType,
	display: ApprovalDisplayMetadata,
): ApprovalInboxItem {
	return {
		id,
		type,
		entityId: id,
		status: "pending",
		requester: {
			id: `employee-${id}`,
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
			teamId: null,
		},
		summary: {
			title: display.title,
			subtitle: display.subtitle,
			detail: display.summary,
			badge: display.badge ?? null,
			...(display.localized
				? {
						localized: {
							title: display.localized.title,
							subtitle: display.localized.subtitle,
							detail: display.localized.summary,
							...(display.localized.badge ? { badge: display.localized.badge } : {}),
						},
					}
				: {}),
		},
		timing: {
			createdAt: "2026-07-20T08:00:00.000Z",
			resolvedAt: null,
			slaDeadline: null,
			ageDays: 1,
		},
		triage: {
			priority: "normal",
			riskLevel: "low",
			riskReasons: [],
			fastLaneGroup: null,
			isPayrollRelevant: false,
			explanation: "",
		},
		capabilities: {
			canApprove: true,
			canReject: true,
			canBulkApprove: true,
			requiresRejectReason: true,
		},
	};
}
