import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseService } from "@/lib/effect/services/database.service";
import type { ApprovalDbService } from "../server/types";

const decisionMocks = vi.hoisted(() => ({
	approveCorrection: vi.fn(() => Effect.void),
	approveOrdinary: vi.fn(() => Effect.void),
}));

vi.mock("@/lib/approvals/server/time-correction-approvals", () => ({
	approveTimeCorrectionWithCurrentApproverEffect:
		decisionMocks.approveCorrection,
	decideTimeCorrectionWithStableTargetEffect: decisionMocks.approveCorrection,
}));

vi.mock("@/lib/approvals/server/work-period-approvals", () => ({
	approveWorkPeriodWithCurrentApproverEffect: decisionMocks.approveOrdinary,
}));

import {
	buildPendingCorrectionReview,
	buildTimeApprovalReview,
	buildTimeApprovalTimelineMessage,
	TimeCorrectionHandler,
} from "./time-correction.handler";

const source = readFileSync(
	"src/lib/approvals/handlers/time-correction.handler.ts",
	"utf8",
);

function handlerSection() {
	const start = source.indexOf("getDetail: (entityId");
	const end = source.indexOf("approve: (_entityId", start);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);

	return source.slice(start, end);
}

describe("TimeCorrectionHandler detail loading", () => {
	it("binds approval detail to the selected approval request within the organization", () => {
		const body = handlerSection();

		expect(body).toContain("context?.approvalId");
		expect(body).toContain("eq(approvalRequest.id, context.approvalId)");
		expect(body).toContain(
			"eq(approvalRequest.organizationId, organizationId)",
		);
		expect(body).toContain('eq(approvalRequest.entityType, "time_entry")');
		expect(body).toContain("eq(approvalRequest.entityId, entityId)");
	});

	it("loads correction entries referenced by approval metadata for review details", () => {
		const body = handlerSection();

		expect(source).toContain("timeEntry");
		expect(body).toContain("correctionMetadataFromRequest(request)");
		expect(body).toContain("clockInCorrectionId");
		expect(body).toContain("pendingCorrection");
		expect(source).toContain("replacesEntryId === period.clockIn.id");
		expect(source).toContain("isOrphaned");
	});
});

describe("buildPendingCorrectionReview", () => {
	const period = {
		id: "period-1",
		employeeId: "emp-1",
		organizationId: "org-1",
		clockInId: "clock-in-original",
		clockOutId: "clock-out-original",
		startTime: new Date("2026-05-22T14:00:00.000Z"),
		endTime: new Date("2026-05-22T18:00:00.000Z"),
		durationMinutes: 240,
		employee: {
			id: "emp-1",
			userId: "user-1",
			teamId: null,
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Kai Hentschel",
				email: "kai@example.com",
				image: null,
			},
		},
		clockIn: {
			id: "clock-in-original",
			organizationId: "org-1",
			employeeId: "emp-1",
			type: "clock_in",
			timestamp: new Date("2026-05-22T14:00:00.000Z"),
			utcOffsetMinutes: 120,
		},
		clockOut: {
			id: "clock-out-original",
			organizationId: "org-1",
			employeeId: "emp-1",
			type: "clock_out",
			timestamp: new Date("2026-05-22T18:00:00.000Z"),
			utcOffsetMinutes: -300,
		},
		pendingChanges: null,
	};

	it("treats legacy requests without resolvable correction entries as orphaned", () => {
		const review = buildPendingCorrectionReview(period, { metadata: null }, []);

		expect(review).toMatchObject({
			clockIn: { requested: null },
			clockOut: { requested: null },
			isOrphaned: true,
		});
	});

	it("resolves a legacy request when exactly one matching correction entry exists", () => {
		const correction = {
			id: "clock-in-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};

		const review = buildPendingCorrectionReview(period, { metadata: null }, [
			correction,
		]);

		expect(review).toMatchObject({
			clockIn: { requested: correction.timestamp },
			clockOut: { requested: null },
			isOrphaned: false,
		});
	});

	it("ignores superseded correction entries when resolving legacy requests", () => {
		const rejectedCorrection = {
			id: "clock-in-rejected-correction",
			timestamp: new Date("2026-05-22T13:45:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: true,
		};
		const activeCorrection = {
			id: "clock-in-active-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};

		const review = buildPendingCorrectionReview(period, { metadata: null }, [
			rejectedCorrection,
			activeCorrection,
		]);

		expect(review).toMatchObject({
			clockIn: { requested: activeCorrection.timestamp },
			isOrphaned: false,
		});
	});
});

describe("shared time-entry approval presentation", () => {
	const period = {
		id: "period-1",
		employeeId: "emp-1",
		organizationId: "org-1",
		clockInId: "clock-in-original",
		clockOutId: "clock-out-original",
		startTime: new Date("2026-05-22T14:00:00.000Z"),
		endTime: new Date("2026-05-22T18:00:00.000Z"),
		durationMinutes: 240,
		pendingChanges: null,
		employee: {
			id: "emp-1",
			userId: "user-1",
			teamId: null,
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Kai Hentschel",
				email: "kai@example.com",
				image: null,
			},
		},
		clockIn: {
			id: "clock-in-original",
			organizationId: "org-1",
			employeeId: "emp-1",
			type: "clock_in",
			timestamp: new Date("2026-05-22T14:00:00.000Z"),
			utcOffsetMinutes: 120,
		},
		clockOut: {
			id: "clock-out-original",
			organizationId: "org-1",
			employeeId: "emp-1",
			type: "clock_out",
			timestamp: new Date("2026-05-22T18:00:00.000Z"),
			utcOffsetMinutes: -300,
		},
	};

	it("keeps manual submissions visible without correction entries", () => {
		const review = buildTimeApprovalReview(
			period,
			{
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				reason: "Manual time entry: missed punch",
			},
			[],
		);

		expect(review).toMatchObject({
			kind: "manual_time_submission",
			isActionable: true,
			warning: null,
			display: {
				title: "Manual Time Submission",
				badge: { label: "Manual" },
				icon: "clock-plus",
			},
		});
		expect(review.pendingCorrection).toBeUndefined();
	});

	it("keeps policy clock-outs visible without correction entries", () => {
		const review = buildTimeApprovalReview(
			period,
			{
				metadata: { timeRequest: { kind: "policy_clock_out" } },
				reason: "Clock-out requires approval (0-day policy)",
			},
			[],
		);

		expect(review).toMatchObject({
			kind: "policy_clock_out",
			isActionable: true,
			display: {
				title: "Clock-out Approval",
				badge: { label: "Clock-out" },
				icon: "clock-check",
			},
		});
		expect(review.pendingCorrection).toBeUndefined();
	});

	it.each([
		["missing kind", { timeRequest: {} }, "Manual time entry: private reason"],
		[
			"extra marker field",
			{
				timeRequest: {
					kind: "manual_time_submission",
					workflowId: "private-workflow-id",
				},
			},
			"Manual time entry: private reason",
		],
		[
			"foreign kind with correction evidence",
			{
				timeRequest: { kind: "absence" },
				timeCorrection: { clockInCorrectionId: "clock-in-correction" },
			},
			null,
		],
	] as const)("fails closed for %s metadata instead of using weaker evidence", (_label, metadata, reason) => {
		const review = buildTimeApprovalReview(period, { metadata, reason }, [
			{
				id: "clock-in-correction",
				timestamp: new Date("2026-05-22T14:15:00.000Z"),
				replacesEntryId: "clock-in-original",
				isSuperseded: false,
			},
		]);

		expect(review).toMatchObject({
			kind: "unclassified",
			isActionable: false,
		});
		expect(review.pendingCorrection).toBeUndefined();
	});

	it.each([
		{
			metadata: {
				timeRequest: { kind: "manual_time_submission" },
				timeCorrection: { clockInCorrectionId: "clock-in-correction" },
			},
			reason: null,
		},
		{
			metadata: { timeRequest: { kind: "manual_time_submission" } },
			reason: "Clock-out requires approval (0-day policy)",
		},
	] as const)("keeps ambiguous or contradictory ordinary evidence unclassified", (request) => {
		const review = buildTimeApprovalReview(period, request, []);

		expect(review).toMatchObject({
			kind: "unclassified",
			isActionable: false,
		});
		expect(review.pendingCorrection).toBeUndefined();
	});

	it.each([
		{
			pendingChanges: "{malformed",
			metadata: null,
			reason: "Manual time entry: private reason",
		},
	] as const)("fails closed for malformed or contradictory historical evidence", (evidence) => {
		const review = buildTimeApprovalReview(
			{ ...period, pendingChanges: evidence.pendingChanges },
			{ metadata: evidence.metadata, reason: evidence.reason },
			[
				{
					id: "clock-in-correction",
					timestamp: new Date("2026-05-22T14:15:00.000Z"),
					replacesEntryId: "clock-in-original",
					isSuperseded: false,
				},
			],
		);

		expect(review).toMatchObject({
			kind: "unclassified",
			isActionable: false,
		});
		expect(review.pendingCorrection).toBeUndefined();
	});

	it("keeps verified correction metadata authoritative over historical ordinary markers", () => {
		const correction = {
			id: "10000000-0000-4000-8000-000000000001",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};
		const review = buildTimeApprovalReview(
			{ ...period, pendingChanges: { isManualEntry: true } },
			{
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: correction.id,
					},
				},
				reason: "Manual time entry: historical prose",
			},
			[correction],
		);

		expect(review).toMatchObject({
			kind: "time_correction",
			isActionable: true,
			pendingCorrection: { isOrphaned: false },
		});
	});

	it("renders manual and clock-out endpoints in their independently captured offsets", () => {
		const review = buildTimeApprovalReview(
			{
				...period,
				clockIn: {
					...period.clockIn,
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
				},
				clockOut: {
					...period.clockOut,
					utcOffsetMinutes: -300,
					timezone: "America/New_York",
				},
			},
			{
				metadata: { timeRequest: { kind: "manual_time_submission" } },
				reason: null,
			},
			[],
		);

		expect(review.display.subtitle).toBe("May 22, 2026 - 16:00 to 13:00");
	});

	it("keeps unclassified legacy rows visible with a non-actionable warning", () => {
		const review = buildTimeApprovalReview(
			period,
			{ metadata: null, reason: "Please review" },
			[],
		);

		expect(review).toMatchObject({
			kind: "unclassified",
			isActionable: false,
			warning:
				"This legacy time approval could not be classified. Reconcile it before making a decision.",
			display: {
				title: "Unclassified Time Approval",
				badge: { label: "Needs reconciliation" },
			},
		});
	});

	it("keeps a list row unclassified when only superseded correction history exists", () => {
		const review = buildTimeApprovalReview(
			period,
			{ metadata: null, reason: "Please review" },
			[
				{
					id: "historical-correction",
					timestamp: new Date("2026-05-22T13:45:00.000Z"),
					replacesEntryId: "clock-in-original",
					isSuperseded: true,
				},
			],
		);

		expect(review).toMatchObject({
			kind: "unclassified",
			isActionable: false,
			warning:
				"This legacy time approval could not be classified. Reconcile it before making a decision.",
		});
		expect(review.pendingCorrection).toBeUndefined();
	});

	it("preserves correction diff and priority presentation", () => {
		const correction = {
			id: "10000000-0000-4000-8000-000000000001",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};
		const review = buildTimeApprovalReview(
			period,
			{
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: correction.id,
					},
				},
				reason: null,
			},
			[correction],
		);

		expect(review).toMatchObject({
			kind: "time_correction",
			isActionable: true,
			display: { title: "Time Correction", badge: { label: "Correction" } },
			pendingCorrection: {
				clockIn: { requested: correction.timestamp },
				isOrphaned: false,
			},
		});
	});

	it("dispatches correction decisions by stable inbox target", () => {
		expect(source).toContain("decideTimeCorrectionWithStableTargetEffect");
		expect(source).toContain("options.approvalRequestId");
	});

	it("scopes inbox work-period loading to the requested organization", () => {
		expect(source).toContain(
			"eq(workPeriod.organizationId, params.organizationId)",
		);
	});
});

describe("resolved time approval timeline labels", () => {
	it.each([
		["time_correction", "approved", undefined, "Correction approved"],
		[
			"time_correction",
			"rejected",
			"Wrong time",
			"Correction rejected: Wrong time",
		],
		[
			"manual_time_submission",
			"approved",
			undefined,
			"Manual time submission approved",
		],
		[
			"manual_time_submission",
			"rejected",
			"Overlap",
			"Manual time submission rejected: Overlap",
		],
		["policy_clock_out", "approved", undefined, "Clock-out approved"],
		[
			"policy_clock_out",
			"rejected",
			"Policy exception",
			"Clock-out rejected: Policy exception",
		],
	] as const)("renders %s %s as a distinct detail timeline label", (kind, status, reason, expected) => {
		expect(buildTimeApprovalTimelineMessage(kind, status, reason)).toBe(
			expected,
		);
	});
});

function createSupersededHistoryDbService() {
	const period = {
		id: "period-1",
		organizationId: "org-1",
		employeeId: "emp-1",
		startTime: new Date("2026-05-22T14:00:00.000Z"),
		endTime: new Date("2026-05-22T18:00:00.000Z"),
		durationMinutes: 240,
		pendingChanges: null,
		clockInId: "clock-in-original",
		clockOutId: "clock-out-original",
		employee: {
			id: "emp-1",
			userId: "user-1",
			teamId: null,
			organizationId: "org-1",
			user: {
				id: "user-1",
				name: "Kai Hentschel",
				email: "kai@example.com",
				image: null,
			},
		},
		clockIn: {
			id: "clock-in-original",
			organizationId: "org-1",
			employeeId: "emp-1",
			type: "clock_in",
			timestamp: new Date("2026-05-22T14:00:00.000Z"),
			utcOffsetMinutes: 120,
		},
		clockOut: {
			id: "clock-out-original",
			organizationId: "org-1",
			employeeId: "emp-1",
			type: "clock_out",
			timestamp: new Date("2026-05-22T18:00:00.000Z"),
			utcOffsetMinutes: -300,
		},
	};
	const request = {
		id: "approval-1",
		entityType: "time_entry",
		entityId: "period-1",
		organizationId: "org-1",
		requestedBy: "emp-1",
		approverId: "manager-1",
		status: "pending",
		reason: "Please review",
		metadata: null,
		createdAt: new Date("2026-05-22T18:05:00.000Z"),
		approvedAt: null,
		rejectionReason: null,
		requester: period.employee,
		approver: null,
	};
	const supersededCorrection = {
		id: "historical-correction",
		type: "correction",
		employeeId: "emp-1",
		organizationId: "org-1",
		timestamp: new Date("2026-05-22T13:45:00.000Z"),
		replacesEntryId: "clock-in-original",
		isSuperseded: true,
	};
	const queryNames: string[] = [];
	const approvalFindFirst = vi.fn().mockResolvedValue(request);
	const approvalChainStageFindMany = vi.fn().mockResolvedValue([]);
	const approvalChainStageFindFirst = vi.fn().mockResolvedValue(null);
	const workPeriodFindMany = vi.fn().mockResolvedValue([period]);
	const timeEntryFindMany = vi.fn().mockResolvedValue([supersededCorrection]);
	const dbService = {
		db: {
			query: {
				employee: {
					findFirst: vi.fn().mockResolvedValue({
						id: "manager-1",
						userId: "manager-user-1",
						organizationId: "org-1",
						isActive: true,
						user: {
							id: "manager-user-1",
							name: "Morgan Manager",
							email: "manager@example.com",
							image: null,
						},
					}),
				},
				approvalRequest: {
					findMany: vi.fn().mockResolvedValue([request]),
					findFirst: approvalFindFirst,
				},
				approvalChainStageInstance: {
					findMany: approvalChainStageFindMany,
					findFirst: approvalChainStageFindFirst,
				},
				workPeriod: {
					findMany: workPeriodFindMany,
					findFirst: vi.fn().mockResolvedValue(period),
				},
				timeEntry: {
					findMany: timeEntryFindMany,
					findFirst: vi.fn().mockResolvedValue(supersededCorrection),
				},
			},
		},
		query: <T>(name: string, fn: () => Promise<T>) => {
			queryNames.push(name);
			return Effect.promise(fn);
		},
	} as unknown as ApprovalDbService;

	return {
		approvalChainStageFindFirst,
		approvalChainStageFindMany,
		approvalFindFirst,
		dbService,
		period,
		queryNames,
		request,
		timeEntryFindMany,
		workPeriodFindMany,
	};
}

describe("superseded correction history regression", () => {
	const invalidEndpointCases = [
		{
			name: "a foreign-organization clock-in",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockIn.organizationId = "org-foreign";
			},
		},
		{
			name: "a wrong-employee clock-in",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockIn.employeeId = "emp-foreign";
			},
		},
		{
			name: "a mismatched clock-in link",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockIn.id = "clock-in-foreign";
			},
		},
		{
			name: "a wrong-type clock-in",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockIn.type = "clock_out";
			},
		},
		{
			name: "a foreign-organization clock-out",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockOut.organizationId = "org-foreign";
			},
		},
		{
			name: "a wrong-employee clock-out",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockOut.employeeId = "emp-foreign";
			},
		},
		{
			name: "a mismatched clock-out link",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockOut.id = "clock-out-foreign";
			},
		},
		{
			name: "a wrong-type clock-out",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.clockOut.type = "clock_in";
			},
		},
	] as const;

	it.each(
		invalidEndpointCases,
	)("omits list rows joined to $name without exposing endpoint or requester data", async ({
		mutate,
	}) => {
		const fixture = createSupersededHistoryDbService();
		mutate(fixture);

		const items = await Effect.runPromise(
			TimeCorrectionHandler.getApprovals({
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			}).pipe(Effect.provideService(DatabaseService, fixture.dbService)),
		);

		const serialized = JSON.stringify(items);
		expect(items).toEqual([]);
		expect(serialized).not.toContain("May 22, 2026");
		expect(serialized).not.toContain("16:00");
		expect(serialized).not.toContain("13:00");
		expect(serialized).not.toContain("Kai Hentschel");
		expect(fixture.timeEntryFindMany).not.toHaveBeenCalled();
	});

	it.each(
		invalidEndpointCases,
	)("rejects detail rows joined to $name without exposing endpoint or requester data", async ({
		mutate,
	}) => {
		const fixture = createSupersededHistoryDbService();
		mutate(fixture);

		let rejection: unknown;
		try {
			await Effect.runPromise(
				TimeCorrectionHandler.getDetail("period-1", "org-1", {
					approvalId: "approval-1",
				}).pipe(Effect.provideService(DatabaseService, fixture.dbService)),
			);
		} catch (error) {
			rejection = error;
		}

		const serialized = JSON.stringify(rejection);
		expect(rejection).toBeDefined();
		expect(String(rejection)).toContain("Work period not found");
		expect(serialized).not.toContain("2026-05-22");
		expect(serialized).not.toContain("120");
		expect(serialized).not.toContain("-300");
		expect(serialized).not.toContain("Kai Hentschel");
		expect(fixture.timeEntryFindMany).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "an employee from another organization",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.employee.organizationId = "org-foreign";
			},
		},
		{
			name: "a request owned by another employee",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.request.requestedBy = "emp-foreign";
			},
		},
	] as const)("omits list rows with $name before correction evidence loading", async ({
		mutate,
	}) => {
		const fixture = createSupersededHistoryDbService();
		mutate(fixture);

		const items = await Effect.runPromise(
			TimeCorrectionHandler.getApprovals({
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			}).pipe(Effect.provideService(DatabaseService, fixture.dbService)),
		);

		expect(items).toEqual([]);
		expect(fixture.timeEntryFindMany).not.toHaveBeenCalled();
	});

	it.each([
		{
			name: "an employee from another organization",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.period.employee.organizationId = "org-foreign";
			},
		},
		{
			name: "a request owned by another employee",
			mutate: (
				fixture: ReturnType<typeof createSupersededHistoryDbService>,
			) => {
				fixture.request.requestedBy = "emp-foreign";
			},
		},
	] as const)("rejects detail rows with $name before correction evidence loading", async ({
		mutate,
	}) => {
		const fixture = createSupersededHistoryDbService();
		mutate(fixture);

		await expect(
			Effect.runPromise(
				TimeCorrectionHandler.getDetail("period-1", "org-1", {
					approvalId: "approval-1",
				}).pipe(Effect.provideService(DatabaseService, fixture.dbService)),
			),
		).rejects.toThrow("Work period not found");
		expect(fixture.timeEntryFindMany).not.toHaveBeenCalled();
	});

	it("loads a sanitized public stage for an ordinary compatibility row", async () => {
		const { approvalChainStageFindMany, dbService, period, request } =
			createSupersededHistoryDbService();
		period.pendingChanges = { isManualEntry: true } as never;
		request.metadata = {
			timeRequest: { kind: "manual_time_submission" },
			stage: {
				id: "50000000-0000-4000-8000-000000000001",
				sequence: 2,
			},
		};
		request.reason = null;
		approvalChainStageFindMany.mockResolvedValue([
			{
				id: "50000000-0000-4000-8000-000000000001",
				organizationId: "org-1",
				approvalRequestId: "approval-1",
				labelSnapshot: "Manager review",
				stepOrder: 2,
			},
		]);

		const items = await Effect.runPromise(
			TimeCorrectionHandler.getApprovals({
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			}).pipe(Effect.provideService(DatabaseService, dbService)),
		);

		expect(items[0]).toMatchObject({
			typeName: "Manual Time Submission",
			display: { stage: { name: "Manager review", order: 2 } },
		});
		expect(JSON.stringify(items[0])).not.toContain(
			"50000000-0000-4000-8000-000000000001",
		);
	});

	it("uses the same metadata fallback for malformed list and detail stages", async () => {
		const fixture = createSupersededHistoryDbService();
		fixture.period.pendingChanges = { isManualEntry: true } as never;
		fixture.request.metadata = {
			timeRequest: { kind: "manual_time_submission" },
			stage: {
				id: "50000000-0000-4000-8000-000000000001",
				sequence: 3,
			},
		};
		fixture.request.reason = null;
		const malformedStage = {
			approvalRequestId: "approval-1",
			labelSnapshot: "",
			stepOrder: 0,
		};
		fixture.approvalChainStageFindMany.mockResolvedValue([malformedStage]);
		fixture.approvalChainStageFindFirst.mockResolvedValue(malformedStage);

		const list = await Effect.runPromise(
			TimeCorrectionHandler.getApprovals({
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			}).pipe(Effect.provideService(DatabaseService, fixture.dbService)),
		);
		const detail = await Effect.runPromise(
			TimeCorrectionHandler.getDetail("period-1", "org-1", {
				approvalId: "approval-1",
			}).pipe(Effect.provideService(DatabaseService, fixture.dbService)),
		);

		expect(list[0]?.display.stage).toEqual({ name: "Approval", order: 3 });
		expect(detail.approval.display.stage).toEqual(list[0]?.display.stage);
	});

	it("keeps the real inbox list item visible and non-actionable", async () => {
		const { dbService } = createSupersededHistoryDbService();
		const items = await Effect.runPromise(
			TimeCorrectionHandler.getApprovals({
				approverId: "manager-1",
				organizationId: "org-1",
				status: "pending",
				limit: 20,
			}).pipe(Effect.provideService(DatabaseService, dbService)),
		);

		expect(items).toHaveLength(1);
		expect(items[0]).toMatchObject({
			typeName: "Unclassified Time Approval",
			isActionable: false,
			warning:
				"This legacy time approval could not be classified. Reconcile it before making a decision.",
		});
	});

	it("keeps the real detail visible and non-actionable", async () => {
		const { dbService } = createSupersededHistoryDbService();
		const detail = await Effect.runPromise(
			TimeCorrectionHandler.getDetail("period-1", "org-1", {
				approvalId: "approval-1",
			}).pipe(Effect.provideService(DatabaseService, dbService)),
		);

		expect(detail.approval).toMatchObject({
			typeName: "Unclassified Time Approval",
			isActionable: false,
		});
		expect(detail.entity).toMatchObject({
			timeApprovalKind: "unclassified",
			timeRequestActionable: false,
		});
		expect(detail.entity.pendingCorrection).toBeUndefined();
	});

	it("defers subtype classification to the stable transaction boundary", async () => {
		decisionMocks.approveCorrection.mockClear();
		const { dbService } = createSupersededHistoryDbService();

		await Effect.runPromise(
			TimeCorrectionHandler.approve("period-1", "manager-1", {
				approvalRequestId: "approval-1",
			}).pipe(Effect.provideService(DatabaseService, dbService)),
		);
		expect(decisionMocks.approveCorrection).toHaveBeenCalledWith(
			dbService,
			expect.objectContaining({ id: "manager-1" }),
			"approval-1",
			"approve",
			undefined,
			{ approvalRequestId: "approval-1" },
		);
	});

	it.each([
		["approve", "approved"],
		["reject", "rejected"],
	] as const)("defers a handler-visible %s status to transaction reload before %s", async (action, status) => {
		decisionMocks.approveCorrection.mockClear();
		const { approvalFindFirst, dbService, request } =
			createSupersededHistoryDbService();
		approvalFindFirst.mockResolvedValueOnce({ ...request, status });

		const decision =
			action === "approve"
				? TimeCorrectionHandler.approve("period-1", "manager-1", {
						approvalRequestId: "approval-1",
					})
				: TimeCorrectionHandler.reject("period-1", "manager-1", "No", {
						approvalRequestId: "approval-1",
					});
		await Effect.runPromise(
			decision.pipe(Effect.provideService(DatabaseService, dbService)),
		);
		expect(decisionMocks.approveCorrection).toHaveBeenCalledOnce();
	});

	it("keeps a later manual-entry chain stage actionable from the period marker", async () => {
		decisionMocks.approveOrdinary.mockClear();
		const { approvalFindFirst, dbService, period, request } =
			createSupersededHistoryDbService();
		period.pendingChanges = { isManualEntry: true } as never;
		approvalFindFirst.mockResolvedValueOnce({
			...request,
			reason: null,
			metadata: { approvalChain: { stageOrder: 2 } },
		});

		await Effect.runPromise(
			TimeCorrectionHandler.approve("period-1", "manager-1", {
				approvalRequestId: "approval-1",
			}).pipe(Effect.provideService(DatabaseService, dbService)),
		);

		expect(decisionMocks.approveOrdinary).not.toHaveBeenCalled();
		expect(decisionMocks.approveCorrection).toHaveBeenCalledWith(
			dbService,
			expect.objectContaining({ id: "manager-1", organizationId: "org-1" }),
			"approval-1",
			"approve",
			undefined,
			{ approvalRequestId: "approval-1" },
		);
	});
});
