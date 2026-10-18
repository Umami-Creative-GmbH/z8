import { Temporal } from "temporal-polyfill";
import {
	instantToCanonicalString,
	parseInstant,
	parsePlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import type { PayrollBlocker } from "@/lib/payroll-workspace/types";
import type { ApprovalDatabase } from "../server/types";
import type { ApprovalTriageContext } from "../triage-assessment";
import type {
	ApprovalInboxTriageEvidenceResult,
	ApprovalInboxTriageTarget,
} from "./triage-evidence";

/** Server-internal context from the authenticated caller; never a client assessment or supplied employee scope. */
export interface PayrollTriageAssessmentContext {
	organizationId: string;
	actor: { userId: string; employeeId: string };
	period: { startDate: string; endDate: string; label: string };
}
export interface PayrollTriageRequestSnapshot {
	context: ApprovalTriageContext;
	authority: "compatibility_request" | "canonical_assignment";
	requestKind: "absence" | "time_correction";
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	canonicalRecordId: string;
	legacyApprovalRequestId: string | null;
	current: boolean;
	/** Includes current source/record state as well as immutable submitted revision. */
	sourceFingerprint: string;
	recordStartAt?: string;
	recordEndAt?: string;
	payrollTimezone?: string;
	scopedCorrectionMapped?: boolean;
}
export interface PayrollTriageAssessment {
	organizationId: string;
	context: ApprovalTriageContext;
	allowedEmployeeIds: readonly string[];
	workSource: "scoped_collection" | "legacy_requests";
	summary: {
		period: { start: string; end: string; label: string };
		generatedAt: string;
		employeeIds: readonly string[];
		blockers: readonly PayrollBlocker[];
	};
}
export interface PayrollTriageOptions {
	assessmentContext?: PayrollTriageAssessmentContext;
	database?: ApprovalDatabase;
	/** Fresh database boundary; a previously computed client assessment is not accepted. */
	readRequest?: (
		target: ApprovalInboxTriageTarget,
	) => Promise<PayrollTriageRequestSnapshot | null>;
	readAssessment?: (input: {
		target: ApprovalInboxTriageTarget;
		request: PayrollTriageRequestSnapshot;
		assessmentContext: PayrollTriageAssessmentContext;
	}) => Promise<PayrollTriageAssessment | null>;
}
function unknown(
	context: ApprovalTriageContext,
	limitation: string,
	validity: "unverifiable" | "stale" = "unverifiable",
): ApprovalInboxTriageEvidenceResult {
	return {
		context,
		evidence: [
			{
				check: "payroll",
				state: "unknown",
				validity,
				context,
				facts: { limitation },
			},
		],
	};
}
function sameContext(
	expected: ApprovalTriageContext,
	actual: ApprovalTriageContext,
): boolean {
	return (
		expected.organizationId === actual.organizationId &&
		expected.requestId === actual.requestId &&
		expected.entityId === actual.entityId &&
		expected.scope === actual.scope &&
		!!actual.revision &&
		(!expected.revision || expected.revision === actual.revision)
	);
}
function explicitPeriod(context: PayrollTriageAssessmentContext): boolean {
	try {
		const { startDate, endDate } = context.period;
		return (
			/^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
			/^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
			parsePlainDate(startDate).toString() === startDate &&
			parsePlainDate(endDate).toString() === endDate &&
			Temporal.PlainDate.compare(
				parsePlainDate(startDate),
				parsePlainDate(endDate),
			) <= 0
		);
	} catch {
		return false;
	}
}

/** Re-evaluates the effective scoped payroll summary and request identity on every call. */
export async function loadPayrollTriageEvidence(
	target: ApprovalInboxTriageTarget,
	options: PayrollTriageOptions = {},
): Promise<ApprovalInboxTriageEvidenceResult> {
	const assessmentContext = options.assessmentContext;
	if (!assessmentContext)
		return unknown(target.context, "payroll_period_unavailable");
	if (
		target.requestKind !== "absence" &&
		target.requestKind !== "time_correction"
	)
		return unknown(target.context, "payroll_request_mapping_unsupported");
	if (
		assessmentContext.organizationId !== target.context.organizationId ||
		!explicitPeriod(assessmentContext)
	)
		return unknown(target.context, "payroll_assessment_scope_unverified");
	try {
		const readRequest: NonNullable<PayrollTriageOptions["readRequest"]> =
			options.readRequest ??
			((currentTarget) =>
				import("./payroll-triage-source").then((source) =>
					source.readPayrollTriageRequest(currentTarget, options.database),
				));
		const request = await readRequest(target);
		if (
			!request ||
			!sameContext({ ...target.context, revision: null }, request.context) ||
			request.authority !== target.authority ||
			request.requestKind !== target.requestKind ||
			(target.subjectEmployeeId &&
				target.subjectEmployeeId !== request.subjectEmployeeId)
		)
			return unknown(target.context, "payroll_request_identity_unverified");
		const context = request.context;
		if (target.context.revision && target.context.revision !== context.revision)
			return unknown(context, "submitted_revision_changed", "stale");
		if (!request.current)
			return unknown(context, "submitted_facts_changed", "stale");
		const readAssessment: NonNullable<PayrollTriageOptions["readAssessment"]> =
			options.readAssessment ??
			((input) =>
				import("./payroll-triage-source").then((source) =>
					source.readAuthorizedPayrollTriageAssessment(input),
				));
		const assessment = await readAssessment({
			target,
			request,
			assessmentContext,
		});
		if (
			assessment &&
			sameContext({ ...context, revision: null }, assessment.context) &&
			assessment.context.revision !== context.revision
		)
			return unknown(context, "payroll_assessment_revision_changed", "stale");
		if (
			!assessment ||
			assessment.organizationId !== context.organizationId ||
			!sameContext(context, assessment.context) ||
			!assessment.allowedEmployeeIds.includes(request.subjectEmployeeId) ||
			!assessment.summary.employeeIds.includes(request.subjectEmployeeId) ||
			assessment.summary.period.start !== assessmentContext.period.startDate ||
			assessment.summary.period.end !== assessmentContext.period.endDate
		)
			return unknown(context, "payroll_assessment_scope_unverified");
		// generatedAt is evidence context, never a TTL. The source computes this summary during this call.
		parseInstant(assessment.summary.generatedAt);
		const current = await readRequest(target);
		if (
			!current?.current ||
			!sameContext(context, current.context) ||
			current.sourceFingerprint !== request.sourceFingerprint ||
			current.authority !== request.authority ||
			current.canonicalRecordId !== request.canonicalRecordId ||
			current.subjectEmployeeId !== request.subjectEmployeeId ||
			current.payrollTimezone !== request.payrollTimezone
		)
			return unknown(
				context,
				"submitted_facts_changed_during_assessment",
				"stale",
			);

		const expectedType =
			target.requestKind === "absence"
				? "pending_absence"
				: assessment.workSource === "scoped_collection"
					? "pending_work_correction"
					: "pending_time_correction";
		const expectedId =
			expectedType === "pending_time_correction"
				? request.legacyApprovalRequestId
				: request.canonicalRecordId;
		if (
			!expectedId ||
			(expectedType === "pending_time_correction" &&
				!assessment.allowedEmployeeIds.includes(request.requesterEmployeeId))
		)
			return unknown(context, "payroll_request_mapping_unsupported");
		const blocker = assessment.summary.blockers.find(
			(item) =>
				item.type === expectedType &&
				item.id === expectedId &&
				item.employeeId === request.subjectEmployeeId,
		);
		const payrollPeriod = {
			startDate: assessmentContext.period.startDate,
			endDate: assessmentContext.period.endDate,
		};
		return {
			context,
			evidence: [
				{
					check: "payroll",
					state: blocker ? "finding" : "clear",
					validity: "current",
					context,
					assessedAt: instantToCanonicalString(systemClock.nowInstant()),
					payrollPeriod,
					...(blocker
						? {
								reason: "payroll_blocker",
								riskLevel: "high" as const,
								facts: {
									sourceId: blocker.id,
									blockerType: blocker.type,
									startDate: payrollPeriod.startDate,
									endDate: payrollPeriod.endDate,
								},
								text: {
									key: "approvals:triage.reasons.payroll_blocker_period",
									fallback:
										"Blocks payroll readiness for {startDate} through {endDate}.",
									params: payrollPeriod,
								},
							}
						: {
								facts: {
									startDate: payrollPeriod.startDate,
									endDate: payrollPeriod.endDate,
								},
							}),
				},
			],
		};
	} catch {
		return unknown(target.context, "payroll_assessment_unavailable");
	}
}
