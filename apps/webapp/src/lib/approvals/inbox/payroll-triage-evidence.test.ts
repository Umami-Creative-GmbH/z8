import { expect, it } from "vitest";
import { loadPayrollTriageEvidence } from "./payroll-triage-evidence";
import { buildInboxTriage } from "./triage";
import type { ApprovalInboxTriageTarget } from "./triage-evidence";

const target: ApprovalInboxTriageTarget = {
	context: {
		organizationId: "org",
		requestId: "request",
		entityId: "absence",
		revision: null,
		scope: "inbox",
	},
	requestKind: "absence",
	type: "absence_entry",
	status: "pending",
	createdAt: "2026-10-18T08:00:00Z",
	priority: "normal",
	authority: "compatibility_request",
};
it("keeps payroll impact unverified without an explicit trusted payroll period", async () => {
	expect(await loadPayrollTriageEvidence(target)).toMatchObject({
		context: target.context,
		evidence: [
			{
				check: "payroll",
				state: "unknown",
				validity: "unverifiable",
				facts: { limitation: "payroll_period_unavailable" },
			},
		],
	});
});

const assessmentContext = {
	organizationId: "org",
	actor: { employeeId: "officer", userId: "officer-user" },
	period: { startDate: "2026-10-01", endDate: "2026-10-31", label: "October" },
};
const requestSnapshot = {
	context: { ...target.context, revision: "revision-1:fingerprint" },
	authority: "compatibility_request" as const,
	requestKind: "absence" as const,
	subjectEmployeeId: "subject",
	requesterEmployeeId: "on-behalf-requester",
	canonicalRecordId: "canonical-absence-record",
	legacyApprovalRequestId: "request",
	current: true,
	sourceFingerprint: "fresh-source",
};
const assessment = {
	organizationId: "org",
	context: requestSnapshot.context,
	allowedEmployeeIds: ["subject"],
	workSource: "legacy_requests" as const,
	summary: {
		period: { start: "2026-10-01", end: "2026-10-31", label: "October" },
		generatedAt: "2026-10-18T09:00:00Z",
		employeeIds: ["subject"],
		blockers: [
			{
				id: "canonical-absence-record",
				employeeId: "subject",
				type: "pending_absence" as const,
				label: "Pending absence",
				date: "2026-10-19",
				time: null,
			},
		],
	},
};
it("maps an absence request to its current canonical payroll record rather than its inbox ID", async () => {
	const result = await loadPayrollTriageEvidence(target, {
		assessmentContext,
		readRequest: async () => requestSnapshot,
		readAssessment: async () => assessment,
	});
	expect(result).toMatchObject({
		context: requestSnapshot.context,
		evidence: [
			{
				check: "payroll",
				state: "finding",
				validity: "current",
				reason: "payroll_blocker",
				payrollPeriod: { startDate: "2026-10-01", endDate: "2026-10-31" },
				facts: {
					sourceId: "canonical-absence-record",
					blockerType: "pending_absence",
				},
			},
		],
	});
});

it.each([
	[
		"compatibility_request",
		"legacy_requests",
		"legacy-correction-request",
		"pending_time_correction",
	],
	[
		"canonical_assignment",
		"scoped_collection",
		"canonical-work-record",
		"pending_work_correction",
	],
] as const)(
	"maps %s corrections through %s payroll identity",
	async (authority, workSource, blockerId, blockerType) => {
		const correctionTarget = {
			...target,
			requestKind: "time_correction" as const,
			type: "time_entry" as const,
			authority,
		};
		const currentRequest = {
			...requestSnapshot,
			authority,
			requestKind: "time_correction" as const,
			canonicalRecordId: "canonical-work-record",
			legacyApprovalRequestId: "legacy-correction-request",
		};
		const currentAssessment = {
			...assessment,
			workSource,
			allowedEmployeeIds: ["subject", "on-behalf-requester"],
			summary: {
				...assessment.summary,
				blockers: [
					{
						id: blockerId,
						employeeId: "subject",
						type: blockerType,
						label: "Pending correction",
						date: "2026-10-19",
						time: null,
					},
				],
			},
		};
		const result = await loadPayrollTriageEvidence(correctionTarget, {
			assessmentContext,
			readRequest: async () => currentRequest,
			readAssessment: async () => currentAssessment,
		});
		expect(result.evidence).toMatchObject([
			{
				state: "finding",
				reason: "payroll_blocker",
				facts: { sourceId: blockerId, blockerType },
			},
		]);
	},
);

it("marks an earlier submitted revision stale instead of reusing its payroll result", async () => {
	const previous = {
		...target,
		context: { ...target.context, revision: "older-revision" },
	};
	const result = await loadPayrollTriageEvidence(previous, {
		assessmentContext,
		readRequest: async () => requestSnapshot,
		readAssessment: async () => assessment,
	});
	expect(result.evidence).toMatchObject([
		{ state: "unknown", validity: "stale" },
	]);
});

it("rejects a payroll summary bound to an earlier revision as stale", async () => {
	const result = await loadPayrollTriageEvidence(target, {
		assessmentContext,
		readRequest: async () => requestSnapshot,
		readAssessment: async () => ({
			...assessment,
			context: { ...assessment.context, revision: "previous" },
		}),
	});
	expect(result.evidence).toMatchObject([
		{ state: "unknown", validity: "stale" },
	]);
});

it.each([
	{ ...assessmentContext, organizationId: "foreign" },
	{
		...assessmentContext,
		period: { ...assessmentContext.period, startDate: "2026-02-30" },
	},
	{
		...assessmentContext,
		period: {
			...assessmentContext.period,
			startDate: "2026-11-01",
			endDate: "2026-10-01",
		},
	},
])(
	"keeps invalid or foreign explicit periods unverified (%j)",
	async (context) => {
		expect(
			(
				await loadPayrollTriageEvidence(target, {
					assessmentContext: context,
					readRequest: async () => requestSnapshot,
					readAssessment: async () => assessment,
				})
			).evidence,
		).toMatchObject([{ state: "unknown" }]);
	},
);
it.each([
	{
		...requestSnapshot,
		context: {
			...requestSnapshot.context,
			requestId: "assignment-instead-of-request",
		},
	},
	{
		...requestSnapshot,
		context: { ...requestSnapshot.context, organizationId: "foreign" },
	},
	{
		...requestSnapshot,
		context: { ...requestSnapshot.context, entityId: "another-absence" },
	},
	{ ...requestSnapshot, authority: "canonical_assignment" as const },
])(
	"keeps unmatched request authority or identity unverified (%j)",
	async (request) => {
		expect(
			(
				await loadPayrollTriageEvidence(target, {
					assessmentContext,
					readRequest: async () => request,
					readAssessment: async () => assessment,
				})
			).evidence,
		).toMatchObject([{ state: "unknown" }]);
	},
);
it.each([
	{ ...assessment, organizationId: "foreign" },
	{ ...assessment, allowedEmployeeIds: [] },
	{ ...assessment, summary: { ...assessment.summary, employeeIds: [] } },
	{
		...assessment,
		summary: {
			...assessment.summary,
			period: { ...assessment.summary.period, end: "2026-11-30" },
		},
	},
	{
		...assessment,
		summary: { ...assessment.summary, generatedAt: "not-an-instant" },
	},
])(
	"keeps incomplete or unauthorized assessment scope unverified (%j)",
	async (summary) => {
		expect(
			(
				await loadPayrollTriageEvidence(target, {
					assessmentContext,
					readRequest: async () => requestSnapshot,
					readAssessment: async () => summary,
				})
			).evidence,
		).toMatchObject([{ state: "unknown" }]);
	},
);
it("rechecks the source revision after the payroll summary rather than trusting an earlier request snapshot", async () => {
	let reads = 0;
	const result = await loadPayrollTriageEvidence(target, {
		assessmentContext,
		readRequest: async () =>
			++reads === 1
				? requestSnapshot
				: { ...requestSnapshot, sourceFingerprint: "changed-source" },
		readAssessment: async () => assessment,
	});
	expect(result.evidence).toMatchObject([
		{ state: "unknown", validity: "stale" },
	]);
});
it("keeps unavailable assessments and unsupported absence changes explicitly unknown", async () => {
	expect(
		(
			await loadPayrollTriageEvidence(target, {
				assessmentContext,
				readRequest: async () => requestSnapshot,
				readAssessment: async () => {
					throw new Error("Payroll unavailable");
				},
			})
		).evidence,
	).toMatchObject([{ state: "unknown" }]);
	expect(
		(
			await loadPayrollTriageEvidence(
				{
					...target,
					requestKind: "absence_change",
					type: "absence_change_request",
				},
				{ assessmentContext },
			)
		).evidence,
	).toMatchObject([
		{
			state: "unknown",
			facts: { limitation: "payroll_request_mapping_unsupported" },
		},
	]);
});
it("retains attribution, coverage and stale reasons alongside a verified payroll blocker", async () => {
	const result = await loadPayrollTriageEvidence(target, {
		assessmentContext,
		readRequest: async () => requestSnapshot,
		readAssessment: async () => assessment,
	});
	const triage = buildInboxTriage({
		type: target.type,
		requestKind: target.requestKind,
		context: result.context,
		createdAt: target.createdAt,
		now: new Date("2026-10-22T00:00:00Z"),
		priority: "urgent",
		status: "pending",
		riskLevel: "high",
		riskReasons: ["work_location_changed"],
		evidence: [
			...result.evidence,
			{
				check: "coverage",
				state: "unknown",
				validity: "unverifiable",
				context: result.context,
			},
		],
	});
	expect(triage).toMatchObject({
		riskLevel: "high",
		fastLaneGroup: "payroll_blocker",
		priority: "urgent",
	});
	expect(triage.riskReasons).toEqual(
		expect.arrayContaining([
			"work_location_changed",
			"payroll_blocker",
			"coverage_unverified",
			"stale_pending",
		]),
	);
});
it("prevents low-risk shortcuts when payroll is unknown despite clear coverage", async () => {
	const result = await loadPayrollTriageEvidence(target);
	const context = { ...result.context, revision: "current" };
	const triage = buildInboxTriage({
		type: target.type,
		requestKind: "absence",
		context,
		createdAt: target.createdAt,
		now: new Date("2026-10-18T09:00:00Z"),
		priority: "normal",
		status: "pending",
		evidence: [
			...result.evidence,
			{ check: "coverage", state: "clear", validity: "current", context },
		],
	});
	expect(triage).toMatchObject({ riskLevel: "medium", fastLaneGroup: null });
	expect(triage.riskReasons).toContain("payroll_unverified");
});
