import {
	instantFromDate,
	parseInstant,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type {
	ApprovalInboxFastLaneGroup,
	ApprovalInboxLocalizedText,
	ApprovalInboxRiskLevel,
} from "./inbox/types";
import type { ApprovalTriagePolicy } from "./triage-policy";

export type ApprovalTriageRequestKind =
	| "time_correction"
	| "absence"
	| "absence_change"
	| "other";
export type ApprovalTriageCheck = "payroll" | "coverage" | "correction";
/** Subject and calculation scope must match before reused evidence is trusted. */
export interface ApprovalTriageContext {
	organizationId: string;
	requestId: string;
	entityId: string;
	revision: string | null;
	scope: string;
}
export interface ApprovalCorrectionTriageFacts {
	plainTimeEdit: boolean;
	originalStart: string;
	originalEnd: string;
	proposedStart: string;
	proposedEnd: string;
}
export interface ApprovalTriageEvidence {
	check: ApprovalTriageCheck;
	state: "finding" | "clear" | "unknown" | "not_applicable";
	validity: "current" | "stale" | "unverifiable";
	limitation?:
		| "missing"
		| "unavailable"
		| "unsupported"
		| "stale"
		| "unverifiable";
	context?: ApprovalTriageContext;
	assessedAt?: string;
	reason?: string;
	text?: ApprovalInboxLocalizedText;
	riskLevel?: "high" | "medium";
	facts?: Record<string, string | number | boolean | null>;
	justification?: string;
	payrollPeriod?: { startDate: string; endDate: string };
	correction?: ApprovalCorrectionTriageFacts;
}
export interface ApprovalTriageReason {
	code: string;
	riskLevel: ApprovalInboxRiskLevel;
	text: ApprovalInboxLocalizedText;
	facts?: Record<string, string | number | boolean | null>;
	supportingFacts?: Array<Record<string, string | number | boolean | null>>;
}
export interface ApprovalTriageAssessment {
	requestKind: ApprovalTriageRequestKind;
	riskLevel: ApprovalInboxRiskLevel;
	riskReasons: string[];
	reasons: ApprovalTriageReason[];
	evidence: ApprovalTriageEvidence[];
	fastLaneGroup: ApprovalInboxFastLaneGroup | null;
	isPayrollRelevant: boolean;
	explanation: string;
}
export interface AssessApprovalTriageInput {
	requestKind: ApprovalTriageRequestKind;
	context?: ApprovalTriageContext;
	status: string;
	createdAt: Date | string;
	now?: Date;
	policy: ApprovalTriagePolicy;
	evidence?: readonly ApprovalTriageEvidence[];
	riskLevel?: ApprovalInboxRiskLevel;
	riskReasons?: readonly string[];
	isPayrollRelevant?: boolean;
}
const HIGH_REASONS = new Set([
	"payroll_blocker",
	"staffing_shortfall",
	"time_entry_deleted",
	"work_category_changed",
	"vehicle_use_changed",
	"work_location_changed",
	"event_local_date_changed",
	"utc_offset_changed",
]);
const REASON_TEXT: Record<string, ApprovalInboxLocalizedText> = {
	payroll_blocker: {
		key: "approvals:triage.reasons.payroll_blocker",
		fallback: "Blocks payroll readiness for the assessed payroll period.",
	},
	staffing_shortfall: {
		key: "approvals:triage.reasons.staffing_shortfall",
		fallback: "The requested absence leaves a staffing shortfall.",
	},
	time_entry_deleted: {
		key: "approvals:triage.reasons.time_entry_deleted",
		fallback: "A recorded time entry will be deleted.",
	},
	work_category_changed: {
		key: "approvals:triage.reasons.work_category_changed",
		fallback: "Work category changes.",
	},
	vehicle_use_changed: {
		key: "approvals:triage.reasons.vehicle_use_changed",
		fallback: "Vehicle use changes.",
	},
	work_location_changed: {
		key: "approvals:triage.reasons.work_location_changed",
		fallback: "Work location changes.",
	},
	event_local_date_changed: {
		key: "approvals:triage.reasons.event_local_date_changed",
		fallback: "The captured event-local date changes.",
	},
	utc_offset_changed: {
		key: "approvals:triage.reasons.utc_offset_changed",
		fallback: "The captured UTC offset changes.",
	},
	policy_exception: {
		key: "approvals:triage.reasons.policy_exception",
		fallback: "Submitted information requires review.",
	},
	payroll_unverified: {
		key: "approvals:triage.reasons.payroll_unverified",
		fallback: "Payroll impact unverified.",
	},
	coverage_unverified: {
		key: "approvals:triage.reasons.coverage_unverified",
		fallback: "Coverage not verified.",
	},
	correction_unverified: {
		key: "approvals:triage.reasons.correction_unverified",
		fallback: "Correction facts not verified.",
	},
};
function matchingContext(
	expected: ApprovalTriageContext | undefined,
	actual: ApprovalTriageContext | undefined,
): boolean {
	return (
		!!expected &&
		!!actual &&
		!!expected.revision &&
		expected.organizationId === actual.organizationId &&
		expected.requestId === actual.requestId &&
		expected.entityId === actual.entityId &&
		expected.revision === actual.revision &&
		expected.scope === actual.scope
	);
}
function validPayrollPeriod(item: ApprovalTriageEvidence): boolean {
	try {
		return (
			!!item.payrollPeriod &&
			parsePlainDate(item.payrollPeriod.startDate).until(
				parsePlainDate(item.payrollPeriod.endDate),
			).sign >= 0
		);
	} catch {
		return false;
	}
}
export function assessApprovalTriage(
	input: AssessApprovalTriageInput,
): ApprovalTriageAssessment {
	const reasons: ApprovalTriageReason[] = [];
	const add = (
		code: string,
		riskLevel: ApprovalInboxRiskLevel,
		text?: ApprovalInboxLocalizedText,
		facts?: ApprovalTriageEvidence["facts"],
	) => {
		const existing = reasons.find((reason) => reason.code === code);
		if (existing) {
			if (riskLevel === "high") existing.riskLevel = "high";
			if (facts) {
				existing.supportingFacts ??= existing.facts ? [existing.facts] : [];
				if (
					!existing.supportingFacts.some(
						(previous) => JSON.stringify(previous) === JSON.stringify(facts),
					)
				)
					existing.supportingFacts.push(facts);
				existing.facts ??= facts;
			}
			return;
		}
		reasons.push({
			code,
			riskLevel,
			text: text ??
				REASON_TEXT[code] ?? {
					key: "approvals:triage.reasons.source_review",
					fallback: "Submitted information requires review.",
				},
			...(facts ? { facts } : {}),
		});
	};
	for (const code of input.riskReasons ?? []) {
		if (
			![
				"small_time_delta",
				"no_conflicts_detected",
				"payroll_relevant",
				"payroll_blocker",
				"staffing_shortfall",
			].includes(code)
		)
			add(
				code,
				input.riskLevel === "high" || HIGH_REASONS.has(code)
					? "high"
					: "medium",
			);
	}
	if (input.riskLevel === "high" && !reasons.length)
		add("source_warning", "high", {
			key: "approvals:triage.reasons.source_warning",
			fallback: "Submitted information has a high-risk warning.",
		});
	const checks: ApprovalTriageCheck[] =
		input.requestKind === "time_correction"
			? ["payroll", "correction"]
			: ["payroll", "coverage"];
	const evidence: ApprovalTriageEvidence[] = checks.flatMap((check) => {
		const supplied = (input.evidence ?? []).filter(
			(item) => item.check === check,
		);
		return (
			supplied.length
				? supplied
				: [
						{
							check,
							state: "unknown" as const,
							validity: "unverifiable" as const,
						},
					]
		).map((item) => {
			const valid =
				!(
					item.check === "payroll" &&
					(item.state === "finding" || item.state === "clear") &&
					!validPayrollPeriod(item)
				) &&
				item.validity === "current" &&
				matchingContext(input.context, item.context) &&
				(item.state !== "not_applicable" || !!item.justification);
			if (valid) return item;
			const { text, ...unverified } = item;
			return {
				...unverified,
				state: "unknown" as const,
				validity:
					item.validity === "stale"
						? ("stale" as const)
						: ("unverifiable" as const),
				...(item.state === "unknown" && text ? { text } : {}),
			};
		});
	});
	for (const item of evidence) {
		if (item.state === "unknown")
			add(`${item.check}_unverified`, "medium", item.text, {
				...item.facts,
				evidenceValidity: item.validity,
				...(item.limitation ? { limitation: item.limitation } : {}),
			});
		else if (item.state === "finding")
			add(
				item.reason ?? `${item.check}_finding`,
				HIGH_REASONS.has(item.reason ?? "")
					? "high"
					: (item.riskLevel ?? "medium"),
				item.text,
				item.facts,
			);
	}
	let stale = false;
	try {
		const submitted =
			typeof input.createdAt === "string"
				? parseInstant(input.createdAt)
				: instantFromDate(input.createdAt);
		const now = input.now
			? instantFromDate(input.now)
			: systemClock.nowInstant();
		stale =
			input.status === "pending" &&
			now.epochNanoseconds - submitted.epochNanoseconds >=
				BigInt(input.policy.staleAfterHours) * BigInt(3_600_000_000_000);
		if (stale)
			add(
				"stale_pending",
				"high",
				{
					key: "approvals:triage.reasons.stale_pending",
					fallback: "Pending for at least {hours} elapsed hours.",
					params: { hours: input.policy.staleAfterHours },
				},
				{ staleAfterHours: input.policy.staleAfterHours },
			);
	} catch {
		add("submission_time_unverified", "medium", {
			key: "approvals:triage.reasons.submission_time_unverified",
			fallback: "Submission time could not be verified.",
		});
	}
	let smallCorrection = false;
	const correction = evidence.find(
		(item) => item.check === "correction" && item.state === "clear",
	)?.correction;
	if (
		!reasons.length &&
		input.requestKind === "time_correction" &&
		correction?.plainTimeEdit &&
		input.policy.smallCorrectionMinutes > 0
	) {
		try {
			const originalStart = parseInstant(
				correction.originalStart,
			).epochNanoseconds;
			const originalEnd = parseInstant(correction.originalEnd).epochNanoseconds;
			const proposedStart = parseInstant(
				correction.proposedStart,
			).epochNanoseconds;
			const proposedEnd = parseInstant(correction.proposedEnd).epochNanoseconds;
			const abs = (value: bigint) => (value < BigInt(0) ? -value : value);
			const limit =
				BigInt(input.policy.smallCorrectionMinutes) * BigInt(60_000_000_000);
			smallCorrection =
				originalEnd > originalStart &&
				proposedEnd > proposedStart &&
				abs(proposedStart - originalStart) <= limit &&
				abs(proposedEnd - originalEnd) <= limit &&
				abs(proposedEnd - proposedStart - (originalEnd - originalStart)) <=
					limit;
		} catch {
			/* Unverifiable endpoints never qualify. */
		}
	}
	if (smallCorrection)
		add(
			"small_time_delta",
			"low",
			{
				key: "approvals:triage.reasons.small_time_delta",
				fallback:
					"Each endpoint and the duration change are within {minutes} minutes.",
				params: { minutes: input.policy.smallCorrectionMinutes },
			},
			{ smallCorrectionMinutes: input.policy.smallCorrectionMinutes },
		);
	const lowAbsence =
		!reasons.length &&
		(input.requestKind === "absence" || input.requestKind === "absence_change");
	if (lowAbsence)
		add("no_conflicts_detected", "low", {
			key: "approvals:triage.reasons.no_conflicts_detected",
			fallback: "Relevant payroll and coverage checks are verified clear.",
		});
	if (!reasons.length)
		add("needs_review", "medium", {
			key: "approvals:triage.reasons.needs_review",
			fallback: "Needs manual review.",
		});
	const riskLevel = reasons.some((reason) => reason.riskLevel === "high")
		? "high"
		: lowAbsence || smallCorrection
			? "low"
			: "medium";
	return {
		requestKind: input.requestKind,
		riskLevel,
		riskReasons: reasons.map((reason) => reason.code),
		reasons,
		evidence,
		fastLaneGroup: evidence.some(
			(item) =>
				item.check === "payroll" &&
				item.state === "finding" &&
				item.reason === "payroll_blocker",
		)
			? "payroll_blocker"
			: stale
				? "stale_pending"
				: lowAbsence
					? "low_risk_absence"
					: smallCorrection
						? "small_time_correction"
						: null,
		isPayrollRelevant: input.isPayrollRelevant === true,
		explanation: reasons.map((reason) => reason.text.fallback).join(" "),
	};
}
