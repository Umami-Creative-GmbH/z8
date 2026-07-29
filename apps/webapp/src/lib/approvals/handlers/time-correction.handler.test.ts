import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	approvalRequest,
	auditLog,
	timeRecord,
	timeRecordApprovalDecision,
	workPeriod,
} from "@/db/schema";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { ApprovalAuditLogger } from "../infrastructure/audit-logger";

const decisionMocks = vi.hoisted(() => ({
	correctionApprove: vi.fn(),
	correctionReject: vi.fn(),
}));

vi.mock("../policies/chain-service", () => ({
	progressApprovalChainIfLinked: vi.fn(() =>
		Effect.succeed({ kind: "not_linked" }),
	),
}));

vi.mock("../server/time-correction-approvals", () => ({
	approveTimeCorrectionWithCurrentApproverEffect:
		decisionMocks.correctionApprove,
	rejectTimeCorrectionWithCurrentApproverEffect: decisionMocks.correctionReject,
	handleApprovedTimeCorrection: decisionMocks.correctionApprove,
	handleRejectedTimeCorrection: decisionMocks.correctionReject,
}));

import {
	buildPendingCorrectionReview,
	buildTimeRequestDisplayMetadata,
	buildWorkPeriodDetailEntity,
	classifyTimeRequest,
	classifyTimeRequestMetadata,
	TimeCorrectionHandler,
} from "./time-correction.handler";

const source = readFileSync(
	"src/lib/approvals/handlers/time-correction.handler.ts",
	"utf8",
);

function handlerSection() {
	const start = source.indexOf("getDetail: (entityId");
	const end = source.indexOf("approve: (entityId", start);

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
			timestamp: new Date("2026-05-22T14:00:00.000Z"),
		},
		clockOut: {
			id: "clock-out-original",
			timestamp: new Date("2026-05-22T18:00:00.000Z"),
		},
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

	it("resolves an explicitly linked inactive modern correction", () => {
		const correction = {
			id: "clock-in-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: true,
		};

		const review = buildPendingCorrectionReview(
			period,
			{
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: correction.id,
					},
				},
			},
			[correction],
		);

		expect(review).toMatchObject({
			clockIn: { requested: correction.timestamp },
			isOrphaned: false,
		});
	});

	it("does not fall back when explicit correction metadata is malformed", () => {
		const unrelatedActiveCorrection = {
			id: "clock-in-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};

		const review = buildPendingCorrectionReview(
			period,
			{
				metadata: {
					timeCorrection: { action: "edit", clockInCorrectionId: "" },
				},
			},
			[unrelatedActiveCorrection],
		);

		expect(review).toMatchObject({
			clockIn: { requested: null },
			isOrphaned: true,
		});
	});

	it("does not fall back when an explicit correction has foreign lineage", () => {
		const declaredCorrection = {
			id: "declared-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "another-original",
			isSuperseded: true,
		};
		const unrelatedActiveCorrection = {
			id: "active-correction",
			timestamp: new Date("2026-05-22T14:30:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};

		const review = buildPendingCorrectionReview(
			period,
			{
				metadata: {
					timeCorrection: {
						action: "edit",
						clockInCorrectionId: declaredCorrection.id,
					},
				},
			},
			[declaredCorrection, unrelatedActiveCorrection],
		);

		expect(review).toMatchObject({
			clockIn: { requested: null },
			isOrphaned: true,
		});
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("classifies %s metadata as a valid ordinary time request", (kind) => {
		expect(classifyTimeRequestMetadata({ timeRequest: { kind } })).toEqual({
			kind: "ordinary",
			requestKind: kind,
		});
	});

	it("classifies metadata-null manual submissions only from exact period and reason evidence", () => {
		expect(
			classifyTimeRequest({
				metadata: null,
				reason: "Manual time entry: Forgot to clock",
				pendingChanges: {
					originalStartTime: "2026-05-22T14:00:00.000Z",
					originalEndTime: "2026-05-22T18:00:00.000Z",
					originalDurationMinutes: 240,
					requestedAt: "2026-05-22T18:01:00.000Z",
					requestedBy: "user-1",
					isManualEntry: true,
					reason: "Forgot to clock",
				},
				clockInId: "clock-in-original",
				clockOutId: "clock-out-original",
				correctionEntries: [],
			}),
		).toEqual({ kind: "ordinary", requestKind: "manual_time_submission" });
	});

	it("classifies metadata-null policy clock-out only from exact period and reason evidence", () => {
		expect(
			classifyTimeRequest({
				metadata: null,
				reason: "Clock-out requires approval (0-day policy)",
				pendingChanges: {
					originalStartTime: "2026-05-22T14:00:00.000Z",
					originalEndTime: "2026-05-22T18:00:00.000Z",
					originalDurationMinutes: 240,
					requestedAt: "2026-05-22T18:01:00.000Z",
					requestedBy: "user-1",
					isNewClockOut: true,
				},
				clockInId: "clock-in-original",
				clockOutId: "clock-out-original",
				correctionEntries: [],
			}),
		).toEqual({ kind: "ordinary", requestKind: "policy_clock_out" });
	});

	it("leaves ambiguous metadata-null rows unclassified", () => {
		expect(
			classifyTimeRequest({
				metadata: null,
				reason: "Manual time entry: Forgot to clock",
				pendingChanges: null,
				clockInId: "clock-in-original",
				clockOutId: "clock-out-original",
				correctionEntries: [],
			}),
		).toEqual({ kind: "unclassified" });
	});

	it("uses exact relational evidence for metadata-null historical corrections", () => {
		expect(
			classifyTimeRequest({
				metadata: null,
				reason: "Adjust clock-in",
				pendingChanges: null,
				clockInId: "clock-in-original",
				clockOutId: "clock-out-original",
				correctionEntries: [
					{
						id: "correction-1",
						replacesEntryId: "clock-in-original",
						isSuperseded: false,
					},
				],
			}),
		).toEqual({ kind: "legacy" });
	});

	it("keeps malformed explicit correction metadata invalid", () => {
		expect(
			classifyTimeRequestMetadata({
				timeCorrection: { action: "edit", clockInCorrectionId: "" },
			}),
		).toEqual({ kind: "invalid" });
	});

	it("lets malformed explicit metadata override historical ordinary evidence", () => {
		expect(
			classifyTimeRequest({
				metadata: {
					timeCorrection: { action: "edit", clockInCorrectionId: "" },
				},
				reason: "Clock-out requires approval (0-day policy)",
				pendingChanges: {
					originalStartTime: "2026-05-22T14:00:00.000Z",
					originalEndTime: "2026-05-22T18:00:00.000Z",
					originalDurationMinutes: 240,
					requestedAt: "2026-05-22T18:01:00.000Z",
					requestedBy: "user-1",
					isNewClockOut: true,
				},
				clockInId: "clock-in-original",
				clockOutId: "clock-out-original",
				correctionEntries: [],
			}),
		).toEqual({ kind: "invalid" });
	});

	it.each([
		["manual_time_submission", "Manual Time Entry"],
		["policy_clock_out", "Clock-out Approval"],
	] as const)("uses ordinary display metadata for %s", (kind, title) => {
		expect(
			buildTimeRequestDisplayMetadata(period, {
				kind: "ordinary",
				requestKind: kind,
			}),
		).toMatchObject({ title, badge: { label: "Time Request" } });
	});
});

describe("buildWorkPeriodDetailEntity", () => {
	it("runtime-allowlists nested detail fields", () => {
		const detail = buildWorkPeriodDetailEntity({
			id: "period-1",
			startTime: new Date("2026-05-22T14:00:00.000Z"),
			endTime: new Date("2026-05-22T18:00:00.000Z"),
			durationMinutes: 240,
			pendingChanges: { requestedBy: "secret-requester" },
			internalNotes: "secret-period-note",
			employee: {
				id: "employee-1",
				userId: "user-1",
				teamId: null,
				organizationId: "org-1",
				authToken: "secret-auth-token",
				user: {
					id: "user-1",
					name: "Kai",
					email: "kai@example.com",
					image: null,
					passwordHash: "secret-password-hash",
					twoFactorSecret: "secret-2fa",
				},
			},
			clockIn: {
				id: "clock-in-1",
				timestamp: new Date("2026-05-22T14:00:00.000Z"),
				ipAddress: "secret-ip",
				deviceInfo: "secret-device",
				hash: "secret-hash",
			},
			clockOut: null,
		} as never);

		expect(Object.keys(detail.employee.user).sort()).toEqual([
			"email",
			"id",
			"image",
			"name",
		]);
		expect(Object.keys(detail.clockIn).sort()).toEqual(["id", "timestamp"]);
		expect(JSON.stringify(detail)).not.toMatch(/secret-/);
		expect(detail).not.toHaveProperty("pendingChanges");
	});
});

describe("TimeCorrectionHandler organization scoping", () => {
	it("scopes actor, batch, period, request, and correction reads in SQL", () => {
		expect(source).toContain("eq(employee.organizationId, organizationId)");
		expect(source).toContain(
			"eq(workPeriod.organizationId, params.organizationId)",
		);
		expect(source).toContain(
			"eq(timeEntry.organizationId, params.organizationId)",
		);
		expect(source).toContain('dbService.query("batchGetOriginalTimeEntries"');
		expect(source).toContain(
			'dbService.query("getOriginalTimeEntriesForDetail"',
		);
		expect(source).toContain('classification.kind !== "ordinary"');
		expect(source).toContain("correctionPeriodRows");
		expect(source).not.toContain("...(organizationId ?");
	});
});

describe("TimeCorrectionHandler ordinary decisions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		decisionMocks.correctionApprove.mockReturnValue(Effect.void);
		decisionMocks.correctionReject.mockReturnValue(Effect.void);
	});

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("approves %s through the transaction-row ordinary finalizer", async (kind) => {
		const { dbService, updateValues } = createDecisionHarness(kind);

		await Effect.runPromise(
			TimeCorrectionHandler.approve("period-1", "manager-1", {
				approvalRequestId: "approval-1",
				organizationId: "org-1",
			} as never).pipe(
				Effect.provideService(DatabaseService, dbService),
				Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
			),
		);

		expect(updateValues).toContainEqual(
			expect.objectContaining({
				approvalStatus: "approved",
				pendingChanges: null,
			}),
		);
		expect(decisionMocks.correctionApprove).not.toHaveBeenCalled();
	}, 15_000);

	it.each([
		"manual_time_submission",
		"policy_clock_out",
	] as const)("rejects %s through the transaction-row ordinary finalizer", async (kind) => {
		const { dbService, updateValues } = createDecisionHarness(kind);

		await Effect.runPromise(
			TimeCorrectionHandler.reject("period-1", "manager-1", "Policy denied", {
				approvalRequestId: "approval-1",
				organizationId: "org-1",
			} as never).pipe(
				Effect.provideService(DatabaseService, dbService),
				Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
			),
		);

		expect(updateValues).toContainEqual(
			expect.objectContaining({
				approvalStatus: "rejected",
				pendingChanges: null,
			}),
		);
		expect(decisionMocks.correctionReject).not.toHaveBeenCalled();
	});

	it.each([
		["approve", "workPeriod"],
		["reject", "workPeriod"],
		["approve", "timeRecord"],
		["reject", "timeRecord"],
	] as const)("rolls back an ordinary %s when the %s CAS loses a race", async (action, raceAt) => {
		const harness = createStatefulDecisionHarness(raceAt);
		const effect =
			action === "approve"
				? TimeCorrectionHandler.approve("period-1", "manager-1", {
						approvalRequestId: "approval-1",
						organizationId: "org-1",
					} as never)
				: TimeCorrectionHandler.reject("period-1", "manager-1", "Denied", {
						approvalRequestId: "approval-1",
						organizationId: "org-1",
					} as never);

		await expect(
			Effect.runPromise(
				effect.pipe(
					Effect.provideService(DatabaseService, harness.dbService),
					Effect.provideService(ApprovalAuditLogger, createAuditLogger()),
				),
			),
		).rejects.toThrow(
			raceAt === "workPeriod"
				? "Work period approval is no longer pending"
				: "Canonical time record approval is no longer pending",
		);
		expect(harness.state()).toEqual({
			approvalStatus: "pending",
			workPeriodStatus: "pending",
			timeRecordStatus: "pending",
			decisionCount: 0,
			auditCount: 0,
		});
	});
});

function createAuditLogger() {
	return ApprovalAuditLogger.of({
		log: vi.fn(() => Effect.void),
		logBatch: vi.fn(() => Effect.void),
	});
}

function createDecisionHarness(
	kind: "manual_time_submission" | "policy_clock_out",
) {
	const updateValues: unknown[] = [];
	const returning = vi.fn(async () => [{ id: "updated" }]);
	const update = vi.fn(() => ({
		set: vi.fn((values: unknown) => {
			updateValues.push(values);
			return { where: vi.fn(() => ({ returning })) };
		}),
	}));
	const tx = {
		query: {
			approvalRequest: {
				findFirst: vi.fn(async () => ({
					id: "approval-1",
					entityId: "period-1",
					entityType: "time_entry",
					approverId: "manager-1",
					organizationId: "org-1",
					status: "pending",
					reason: "Review time",
					approvedAt: null,
					rejectionReason: null,
					metadata: { timeRequest: { kind } },
					updatedAt: new Date("2026-05-22T18:30:00.000Z"),
				})),
			},
			workPeriod: {
				findFirst: vi.fn(async () => ({
					id: "period-1",
					organizationId: "org-1",
					canonicalRecordId: "record-1",
					approvalStatus: "pending",
				})),
			},
		},
		update,
		insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
	};
	const dbService = DatabaseService.of({
		db: {
			select: vi.fn(() => ({
				from: vi.fn(() => ({ where: vi.fn(() => sql`true`) })),
			})),
			query: {
				employee: {
					findFirst: vi.fn(async () => ({
						id: "manager-1",
						userId: "manager-user-1",
						organizationId: "org-1",
						isActive: true,
						user: {
							id: "manager-user-1",
							name: "Morgan Manager",
							email: "morgan@example.com",
							image: null,
						},
					})),
				},
			},
			transaction: vi.fn(
				async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
			),
		} as never,
		query: (_name, operation) => Effect.promise(operation),
	});

	return { dbService, updateValues };
}

function createStatefulDecisionHarness(raceAt: "workPeriod" | "timeRecord") {
	let state = {
		approvalStatus: "pending",
		workPeriodStatus: "pending",
		timeRecordStatus: "pending",
		decisionCount: 0,
		auditCount: 0,
	};
	const tx = {
		query: {
			approvalRequest: {
				findFirst: vi.fn(async () =>
					state.approvalStatus === "pending"
						? {
								id: "approval-1",
								entityId: "period-1",
								entityType: "time_entry",
								approverId: "manager-1",
								organizationId: "org-1",
								status: "pending",
								reason: "Manual time entry: Forgot to clock",
								metadata: {
									timeRequest: { kind: "manual_time_submission" },
								},
							}
						: undefined,
				),
			},
			workPeriod: {
				findFirst: vi.fn(async () => ({
					id: "period-1",
					canonicalRecordId: "record-1",
					approvalStatus: state.workPeriodStatus,
				})),
			},
		},
		update: vi.fn((table: unknown) => ({
			set: vi.fn((values: Record<string, unknown>) => ({
				where: vi.fn(() => ({
					returning: vi.fn(async () => {
						if (table === approvalRequest) {
							if (state.approvalStatus !== "pending") return [];
							state.approvalStatus = values.status as string;
							return [{ id: "approval-1" }];
						}
						if (table === workPeriod) {
							if (
								raceAt === "workPeriod" ||
								state.workPeriodStatus !== "pending"
							)
								return [];
							state.workPeriodStatus = values.approvalStatus as string;
							return [{ id: "period-1" }];
						}
						if (table === timeRecord) {
							if (
								raceAt === "timeRecord" ||
								state.timeRecordStatus !== "pending"
							)
								return [];
							state.timeRecordStatus = values.approvalState as string;
							return [{ id: "record-1" }];
						}
						return [];
					}),
				})),
			})),
		})),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn(async () => {
				if (table === timeRecordApprovalDecision) state.decisionCount += 1;
				if (table === auditLog) state.auditCount += 1;
			}),
		})),
	};
	const dbService = DatabaseService.of({
		db: {
			select: vi.fn(() => ({
				from: vi.fn(() => ({ where: vi.fn(() => sql`true`) })),
			})),
			query: {
				employee: {
					findFirst: vi.fn(async () => ({
						id: "manager-1",
						userId: "manager-user-1",
						organizationId: "org-1",
						isActive: true,
						user: {
							id: "manager-user-1",
							name: "Morgan Manager",
							email: "morgan@example.com",
							image: null,
						},
					})),
				},
			},
			transaction: vi.fn(
				async (callback: (client: typeof tx) => Promise<void>) => {
					const snapshot = { ...state };
					try {
						await callback(tx);
					} catch (error) {
						state = snapshot;
						throw error;
					}
				},
			),
		} as never,
		query: (_name, operation) => Effect.promise(operation),
	});

	return { dbService, state: () => state };
}
