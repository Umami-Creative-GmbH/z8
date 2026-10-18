import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	formatCapturedOffsetInstant,
	formatUtcOffset,
} from "@/lib/datetime/temporal-format";
import type { ApprovalTriageReason } from "../triage-assessment";
import type { ApprovalInboxLocalizedText, ApprovalInboxValue } from "./types";

const LABELS: Record<string, ApprovalInboxLocalizedText> = {
	available: { key: "approvals:triage.facts.available", fallback: "Available" },
	required: { key: "approvals:triage.facts.required", fallback: "Required" },
	evidenceValidity: {
		key: "approvals:triage.facts.evidenceValidity",
		fallback: "Evidence validity",
	},
	limitation: {
		key: "approvals:triage.facts.limitation",
		fallback: "Evidence limitation",
	},
	staffCount: {
		key: "approvals:triage.facts.staffCount",
		fallback: "Available staff",
	},
	minimumStaffCount: {
		key: "approvals:triage.facts.minimumStaffCount",
		fallback: "Required staff",
	},
	subareaName: {
		key: "approvals:triage.facts.subareaName",
		fallback: "Staffing area",
	},
	date: { key: "approvals:triage.facts.date", fallback: "Date" },
	startDate: {
		key: "approvals:triage.facts.startDate",
		fallback: "Start date",
	},
	endDate: { key: "approvals:triage.facts.endDate", fallback: "End date" },
	originalStartDate: {
		key: "approvals:triage.facts.originalStartDate",
		fallback: "Recorded start date",
	},
	originalEndDate: {
		key: "approvals:triage.facts.originalEndDate",
		fallback: "Recorded end date",
	},
	proposedStartDate: {
		key: "approvals:triage.facts.proposedStartDate",
		fallback: "Proposed start date",
	},
	proposedEndDate: {
		key: "approvals:triage.facts.proposedEndDate",
		fallback: "Proposed end date",
	},
	originalLocalDate: {
		key: "approvals:triage.facts.originalLocalDate",
		fallback: "Recorded local date",
	},
	proposedLocalDate: {
		key: "approvals:triage.facts.proposedLocalDate",
		fallback: "Proposed local date",
	},
	timezone: { key: "approvals:triage.facts.timezone", fallback: "Time zone" },
	startTime: {
		key: "approvals:triage.facts.startTime",
		fallback: "Start time",
	},
	endTime: { key: "approvals:triage.facts.endTime", fallback: "End time" },
	originalAt: {
		key: "approvals:triage.facts.originalAt",
		fallback: "Recorded endpoint",
	},
	proposedAt: {
		key: "approvals:triage.facts.proposedAt",
		fallback: "Proposed endpoint",
	},
	originalOffsetMinutes: {
		key: "approvals:triage.facts.originalOffsetMinutes",
		fallback: "Recorded UTC offset",
	},
	proposedOffsetMinutes: {
		key: "approvals:triage.facts.proposedOffsetMinutes",
		fallback: "Proposed UTC offset",
	},
	endpoint: { key: "approvals:triage.facts.endpoint", fallback: "Endpoint" },
	kind: { key: "approvals:triage.facts.kind", fallback: "Requested change" },
	intent: { key: "approvals:triage.facts.intent", fallback: "Correction type" },
	staleAfterHours: {
		key: "approvals:triage.facts.staleAfterHours",
		fallback: "Pending threshold (hours)",
	},
	smallCorrectionMinutes: {
		key: "approvals:triage.facts.smallCorrectionMinutes",
		fallback: "Small correction limit (minutes)",
	},
	originalValue: {
		key: "approvals:triage.facts.originalValue",
		fallback: "Recorded location",
	},
	proposedValue: {
		key: "approvals:triage.facts.proposedValue",
		fallback: "Proposed location",
	},
	blockerType: {
		key: "approvals:triage.facts.blockerType",
		fallback: "Payroll blocker",
	},
};
const VALUES: Record<string, ApprovalInboxLocalizedText> = {
	yes: { key: "approvals:triage.values.yes", fallback: "Yes" },
	no: { key: "approvals:triage.values.no", fallback: "No" },
	current: { key: "approvals:triage.values.current", fallback: "Current" },
	stale: {
		key: "approvals:triage.values.stale",
		fallback: "Changed since submission",
	},
	unverifiable: {
		key: "approvals:triage.values.unverifiable",
		fallback: "Not verified",
	},
	missing: {
		key: "approvals:triage.values.missing",
		fallback: "Evidence missing",
	},
	unavailable: {
		key: "approvals:triage.values.unavailable",
		fallback: "Evidence unavailable",
	},
	unsupported: {
		key: "approvals:triage.values.unsupported",
		fallback: "Not supported by this check",
	},
	clock_in: { key: "approvals:triage.values.clock_in", fallback: "Clock in" },
	clock_out: {
		key: "approvals:triage.values.clock_out",
		fallback: "Clock out",
	},
	edit: { key: "approvals:triage.values.edit", fallback: "Time edit" },
	delete: { key: "approvals:triage.values.delete", fallback: "Time deletion" },
	metadata_only: {
		key: "approvals:triage.values.metadata_only",
		fallback: "Work details only",
	},
	change: { key: "approvals:triage.values.change", fallback: "Change absence" },
	cancel: { key: "approvals:triage.values.cancel", fallback: "Cancel absence" },
	office: { key: "approvals:triage.values.office", fallback: "Office" },
	home: { key: "approvals:triage.values.home", fallback: "Home" },
	remote: { key: "approvals:triage.values.remote", fallback: "Remote" },
	other: { key: "approvals:triage.values.other", fallback: "Other" },
	pending_absence: {
		key: "approvals:triage.values.pending_absence",
		fallback: "Pending absence",
	},
	pending_work_correction: {
		key: "approvals:triage.values.pending_work_correction",
		fallback: "Pending work correction",
	},
	pending_time_correction: {
		key: "approvals:triage.values.pending_time_correction",
		fallback: "Pending time correction",
	},
	endpoint_capture_unverified: {
		key: "approvals:triage.values.endpoint_capture_unverified",
		fallback: "Captured endpoints are not fully verified",
	},
	source_unavailable: {
		key: "approvals:triage.values.source_unavailable",
		fallback: "Current request evidence unavailable",
	},
	unsupported_request_identity: {
		key: "approvals:triage.values.unsupported_request_identity",
		fallback: "This request cannot be verified",
	},
	request_or_submission_unverified: {
		key: "approvals:triage.values.request_or_submission_unverified",
		fallback: "The submitted request is not verified",
	},
	submitted_or_effective_absence_changed: {
		key: "approvals:triage.values.submitted_or_effective_absence_changed",
		fallback: "The submission or effective absence changed",
	},
	staffing_context_unavailable: {
		key: "approvals:triage.values.staffing_context_unavailable",
		fallback: "Staffing context unavailable",
	},
	submitted_facts_changed: {
		key: "approvals:triage.values.submitted_facts_changed",
		fallback: "Submitted facts changed",
	},
	unsupported_change_coverage: {
		key: "approvals:triage.values.unsupported_change_coverage",
		fallback: "This absence change is not supported by the staffing check",
	},
	unsupported_absence_coverage: {
		key: "approvals:triage.values.unsupported_absence_coverage",
		fallback: "This absence period is not supported by the staffing check",
	},
	published_shifts_not_verified: {
		key: "approvals:triage.values.published_shifts_not_verified",
		fallback: "Published shifts are not verified",
	},
	unsupported_shift_interval: {
		key: "approvals:triage.values.unsupported_shift_interval",
		fallback: "A shift interval is not supported by the staffing check",
	},
	unsupported_coverage_rule: {
		key: "approvals:triage.values.unsupported_coverage_rule",
		fallback: "A staffing rule is not supported by the check",
	},
	colleague_absence_coverage_unverified: {
		key: "approvals:triage.values.colleague_absence_coverage_unverified",
		fallback: "Colleague absence coverage is not verified",
	},
	coverage_rule_gap: {
		key: "approvals:triage.values.coverage_rule_gap",
		fallback: "A staffing rule does not cover the entire interval",
	},
	payroll_period_unavailable: {
		key: "approvals:triage.values.payroll_period_unavailable",
		fallback: "No explicit payroll period is available",
	},
	payroll_request_mapping_unsupported: {
		key: "approvals:triage.values.payroll_request_mapping_unsupported",
		fallback: "This request cannot be mapped to payroll readiness",
	},
	payroll_assessment_scope_unverified: {
		key: "approvals:triage.values.payroll_assessment_scope_unverified",
		fallback: "The payroll assessment scope is not verified",
	},
	payroll_request_identity_unverified: {
		key: "approvals:triage.values.payroll_request_identity_unverified",
		fallback: "The payroll request is not verified",
	},
	submitted_revision_changed: {
		key: "approvals:triage.values.submitted_revision_changed",
		fallback: "The submitted revision changed",
	},
	payroll_assessment_revision_changed: {
		key: "approvals:triage.values.payroll_assessment_revision_changed",
		fallback: "The payroll assessment changed",
	},
	submitted_facts_changed_during_assessment: {
		key: "approvals:triage.values.submitted_facts_changed_during_assessment",
		fallback: "Submitted facts changed during the assessment",
	},
	payroll_assessment_unavailable: {
		key: "approvals:triage.values.payroll_assessment_unavailable",
		fallback: "Payroll readiness assessment unavailable",
	},
};

const DATE_KEYS = new Set([
	"date",
	"startDate",
	"endDate",
	"originalStartDate",
	"originalEndDate",
	"proposedStartDate",
	"proposedEndDate",
	"originalLocalDate",
	"proposedLocalDate",
]);
type Text = (
	value: string | ApprovalInboxLocalizedText | ApprovalInboxValue,
) => string;
/** Explicit domain facts only; internal identities and unknown codes never become UI copy. */
export function presentTriageFacts(
	facts: NonNullable<ApprovalTriageReason["facts"]>,
	reason: string,
	locale: string,
	numberFormat: Intl.NumberFormat,
	text: Text,
): { key: string; label: string; value: string }[] {
	return Object.entries(facts).flatMap(([key, value]) => {
		if (value === null || !LABELS[key]) return [];
		let rendered: string;
		try {
			if (key === "originalValue" || key === "proposedValue") {
				if (
					reason !== "work_location_changed" ||
					typeof value !== "string" ||
					!VALUES[value]
				)
					return [];
				rendered = text(VALUES[value]);
			} else if (key === "limitation") {
				rendered = String(value)
					.split(", ")
					.map((code) => text(VALUES[code] ?? VALUES.unverifiable))
					.join("; ");
			} else if (
				[
					"evidenceValidity",
					"endpoint",
					"kind",
					"intent",
					"blockerType",
				].includes(key)
			) {
				rendered = text(VALUES[String(value)] ?? VALUES.unverifiable);
			} else if (DATE_KEYS.has(key) && typeof value === "string") {
				rendered = text({ kind: "plain_date", date: value });
			} else if (key === "originalAt" || key === "proposedAt") {
				const offset =
					facts[
						key === "originalAt"
							? "originalOffsetMinutes"
							: "proposedOffsetMinutes"
					];
				if (typeof value !== "string" || typeof offset !== "number") return [];
				rendered = `${formatCapturedOffsetInstant(parseInstant(value), { locale, timeFormat: "24h", offsetMinutes: offset, preset: "dateTimeMedium" })} (${formatUtcOffset(offset)})`;
			} else if (
				key === "originalOffsetMinutes" ||
				key === "proposedOffsetMinutes"
			) {
				if (typeof value !== "number") return [];
				rendered = formatUtcOffset(value);
			} else if (typeof value === "number")
				rendered = numberFormat.format(value);
			else if (typeof value === "boolean")
				rendered = text(value ? VALUES.yes : VALUES.no);
			else rendered = value;
		} catch {
			rendered = text(VALUES.unverifiable);
		}
		return [{ key, label: text(LABELS[key]), value: rendered }];
	});
}
/** Dates interpolated into a reason use the same locale formatting as its supporting facts. */
export function presentTriageReasonText(
	reason: ApprovalTriageReason,
): ApprovalInboxLocalizedText {
	return {
		...reason.text,
		params: Object.fromEntries(
			Object.entries(reason.text.params ?? {}).map(([key, value]) => [
				key,
				DATE_KEYS.has(key) &&
				typeof value === "string" &&
				/^\d{4}-\d{2}-\d{2}$/.test(value)
					? { kind: "plain_date", date: value }
					: value,
			]),
		),
	};
}
