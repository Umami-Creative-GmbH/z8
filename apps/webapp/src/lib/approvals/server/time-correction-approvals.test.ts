import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./time-correction-approvals.ts", import.meta.url)), "utf8");

const { markEmployeeWorkBalanceDirty, onTimeCorrectionApproved, onTimeCorrectionRejected } =
	vi.hoisted(() => ({
		markEmployeeWorkBalanceDirty: vi.fn().mockResolvedValue(undefined),
		onTimeCorrectionApproved: vi.fn(),
		onTimeCorrectionRejected: vi.fn(),
	}));

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onTimeCorrectionApproved,
	onTimeCorrectionRejected,
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty,
}));

import { ApprovalAuditLogger } from "@/lib/approvals/infrastructure/audit-logger";
import { resolvePolicyAndCreateApproval } from "@/lib/approvals/policies/chain-service";
import {
	approveTimeCorrectionWithCurrentApproverEffect,
	buildTimeCorrectionApprovalPolicyContext,
	calculateCorrectedDurationMinutes,
	createTimeCorrectionApprovalWorkflow,
	rejectTimeCorrectionWithCurrentApproverEffect,
} from "@/lib/approvals/server/time-correction-approvals";
import type { ApprovalDbService, CurrentApprover } from "@/lib/approvals/server/types";

beforeEach(() => {
	markEmployeeWorkBalanceDirty.mockClear();
	onTimeCorrectionApproved.mockClear();
	onTimeCorrectionRejected.mockClear();
});

function createPolicyResolutionDbService(policies: unknown[]) {
	const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
	const dbService = {
		db: {
			query: {
				approvalRequest: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalPolicy: { findMany: vi.fn().mockResolvedValue(policies) },
				employeeGroupMember: { findMany: vi.fn().mockResolvedValue([]) },
				employeeGroup: { findMany: vi.fn().mockResolvedValue([]) },
				employee: {
					findMany: vi.fn().mockResolvedValue([
						{
							id: "emp-requester",
							userId: "user-requester",
							organizationId: "org-1",
							isActive: true,
							role: "employee",
						},
						{ id: "emp-manager", organizationId: "org-1", isActive: true, role: "manager" },
					]),
				},
				employeeManagers: {
					findMany: vi
						.fn()
						.mockResolvedValue([
							{ employeeId: "emp-requester", managerId: "emp-manager", isPrimary: true },
						]),
				},
				teamMembership: { findMany: vi.fn().mockResolvedValue([]) },
				team: { findMany: vi.fn().mockResolvedValue([]) },
			},
			insert: vi.fn((table: unknown) => ({
				values: vi.fn((values: Record<string, unknown>) => {
					inserts.push({ table, values });
					return { returning: vi.fn().mockResolvedValue([{ id: `insert-${inserts.length}` }]) };
				}),
			})),
			update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
		},
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService;

	return { dbService, inserts };
}

const timePolicyContext = buildTimeCorrectionApprovalPolicyContext({
	organizationId: "org-1",
	requesterEmployeeId: "emp-requester",
	teamId: "team-1",
	workPeriodId: "period-1",
	overtimeRisk: "warning",
});

const timeCorrectionCurrentApprover: CurrentApprover = {
	id: "emp-manager",
	userId: "user-manager",
	organizationId: "org-1",
	user: {
		id: "user-manager",
		name: "Morgan Manager",
		email: "morgan@example.com",
		image: null,
	},
};

const period = {
	id: "period-1",
	employeeId: "emp-requester",
	clockInId: "entry-original",
	clockOutId: null,
	organizationId: "org-1",
	canonicalRecordId: null,
	startTime: new Date("2026-05-11T08:00:00.000Z"),
	endTime: new Date("2026-05-11T16:00:00.000Z"),
	durationMinutes: 480,
	employee: {
		userId: "user-requester",
		organizationId: "org-1",
		user: { name: "Avery Requester", email: "avery@example.com", image: null },
	},
};

const correction = {
	id: "entry-correction",
	timestamp: new Date("2026-05-11T08:15:00.000Z"),
	replacesEntryId: "entry-original",
	isSuperseded: false,
};

const rejectedCorrection = {
	id: "entry-rejected-correction",
	timestamp: new Date("2026-05-11T07:45:00.000Z"),
	replacesEntryId: "entry-original",
	isSuperseded: true,
};

const clockOutCorrection = {
	id: "entry-clock-out-correction",
	timestamp: new Date("2026-05-11T16:15:00.000Z"),
	replacesEntryId: "entry-clock-out-original",
	isSuperseded: false,
};

function createTimeCorrectionDecisionDbService() {
	const updateSets: Record<string, unknown>[] = [];
	const db = {
		query: {
			approvalRequest: {
				findFirst: vi.fn().mockResolvedValue({
					id: "approval-1",
					organizationId: "org-1",
					entityType: "time_entry",
					entityId: "period-1",
					requestedBy: "emp-requester",
					approverId: "emp-manager",
					status: "pending",
					metadata: { timeCorrection: { clockInCorrectionId: "entry-correction" } },
				}),
			},
			approvalChainStageInstance: { findFirst: vi.fn().mockResolvedValue(null) },
			workPeriod: { findFirst: vi.fn().mockResolvedValue(period) },
			timeEntry: { findFirst: vi.fn().mockResolvedValue(correction) },
		},
		select: vi.fn().mockReturnValue({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([correction]) }),
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn((values: Record<string, unknown>) => {
				updateSets.push(values);
				return { where: vi.fn() };
			}),
		}),
		insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
		transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(db)),
	};

	return {
		db,
		updateSets,
		query: <T>(_name: string, fn: () => Promise<T>) => Effect.promise(fn),
	} as unknown as ApprovalDbService & { updateSets: Record<string, unknown>[] };
}

function runTimeCorrectionDecisionEffect(effect: Effect.Effect<unknown, unknown, unknown>) {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(ApprovalAuditLogger, {
				log: vi.fn(() => Effect.void),
				logBatch: vi.fn(() => Effect.void),
			}),
		),
	);
}

describe("calculateCorrectedDurationMinutes", () => {
	it("returns minutes when corrected clock-in and clock-out exist", () => {
		const result = calculateCorrectedDurationMinutes(
			new Date("2026-03-09T09:00:00.000Z"),
			new Date("2026-03-09T17:30:00.000Z"),
		);

		expect(result).toBe(510);
	});
});

describe("time correction approval workflow safety", () => {
	it("scopes pending time correction approval checks to the workflow organization", () => {
		const start = source.indexOf("function ensureNoPendingTimeCorrectionApproval");
		expect(start).toBeGreaterThanOrEqual(0);
		const body = source.slice(start, source.indexOf("export async function syncCanonicalWorkCorrection", start));

		expect(body).toContain("organizationId: string");
		expect(body).toContain("eq(approvalRequest.organizationId, organizationId)");
	});
});

describe("time correction requester decision notifications", () => {
	it("marks work balances dirty after approving a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			employeeId: "emp-requester",
			organizationId: "org-1",
			dirtyFromDate: "2026-05-11",
		});
		expect(dbService.db.transaction).toHaveBeenCalled();
		expect(vi.mocked(dbService.db.transaction).mock.invocationCallOrder[0]).toBeLessThan(
			markEmployeeWorkBalanceDirty.mock.invocationCallOrder[0],
		);
	});

	it("keeps approval successful when dirty marking fails", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		markEmployeeWorkBalanceDirty.mockRejectedValueOnce(new Error("dirty marker failed"));

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).resolves.toBeDefined();
		expect(onTimeCorrectionApproved).toHaveBeenCalled();
	});

	it("notifies the requester after approving a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(onTimeCorrectionApproved).toHaveBeenCalledWith({
			workPeriodId: "period-1",
			employeeUserId: "user-requester",
			employeeName: "Avery Requester",
			organizationId: "org-1",
			originalTime: period.startTime,
			correctedTime: correction.timestamp,
			approverName: "Morgan Manager",
		});
		expect(onTimeCorrectionRejected).not.toHaveBeenCalled();
	});

	it("activates linked pending corrections and supersedes originals after approving a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correction.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce({ ...correction, isSuperseded: true })
			.mockResolvedValueOnce({ ...clockOutCorrection, isSuperseded: true });

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				{ isSuperseded: false, supersededById: null },
				{ isSuperseded: true, supersededById: correction.id },
			]),
		);
	});

	it("approves the active correction instead of an older rejected correction for the same period", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi
				.fn()
				.mockReturnValue({ where: vi.fn().mockResolvedValue([rejectedCorrection, correction]) }),
		} as never);

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: "entry-correction",
					startTime: correction.timestamp,
				}),
			]),
		);
		expect(onTimeCorrectionApproved).toHaveBeenCalledWith(
			expect.objectContaining({ correctedTime: correction.timestamp }),
		);
	});

	it("approves the correction entry linked to the approval request instead of unrelated rows", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const linkedCorrection = {
			id: "entry-linked-correction",
			timestamp: new Date("2026-05-11T08:30:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: false,
		};
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: { timeCorrection: { clockInCorrectionId: linkedCorrection.id } },
		});
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([correction]) }),
		} as never);
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce(linkedCorrection);

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					clockInId: linkedCorrection.id,
					startTime: linkedCorrection.timestamp,
				}),
			]),
		);
		expect(dbService.db.query.timeEntry.findFirst).toHaveBeenCalled();
	});

	it("rejects approval application when a clock-in-only correction is after the existing clock-out", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const invalidCorrection = {
			...correction,
			timestamp: new Date("2026-05-11T17:00:00.000Z"),
		};
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce(invalidCorrection);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("Clock out time must be after clock in time");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ clockInId: invalidCorrection.id })]),
		);
	});

	it("approves a legacy pending correction without metadata when one active correction is unambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});

		await runTimeCorrectionDecisionEffect(
			approveTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ clockInId: correction.id, startTime: correction.timestamp }),
			]),
		);
	});

	it("rejects a legacy pending correction without metadata when active corrections are ambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const secondCorrection = {
			id: "entry-second-correction",
			timestamp: new Date("2026-05-11T08:45:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: false,
		};
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi
				.fn()
				.mockReturnValue({ where: vi.fn().mockResolvedValue([correction, secondCorrection]) }),
		} as never);

		await expect(
			runTimeCorrectionDecisionEffect(
				approveTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
				),
			),
		).rejects.toThrow("ambiguous legacy time correction approval");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ clockInId: correction.id })]),
		);
	});

	it("notifies the requester after rejecting a time correction request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(onTimeCorrectionRejected).toHaveBeenCalledWith(
			expect.objectContaining({
				workPeriodId: "period-1",
				employeeUserId: "user-requester",
				organizationId: "org-1",
				approverName: "Morgan Manager",
				rejectionReason: "Incorrect correction",
			}),
		);
		expect(onTimeCorrectionApproved).not.toHaveBeenCalled();
	});

	it("keeps linked pending corrections inactive without reactivating originals after rejection", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.workPeriod.findFirst).mockResolvedValueOnce({
			...period,
			clockOutId: "entry-clock-out-original",
		});
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correction.id,
					clockOutCorrectionId: clockOutCorrection.id,
				},
			},
		});
		vi.mocked(dbService.db.query.timeEntry.findFirst)
			.mockResolvedValueOnce({ ...correction, isSuperseded: true })
			.mockResolvedValueOnce({ ...clockOutCorrection, isSuperseded: true });

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: false, supersededById: null }]),
		);
	});

	it("does not roll back older superseded correction entries when rejecting a pending time correction", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi
				.fn()
				.mockReturnValue({ where: vi.fn().mockResolvedValue([rejectedCorrection, correction]) }),
		} as never);

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "entry-rejected-correction" })]),
		);
	});

	it("rejects only the correction entries linked to the approval request", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const linkedCorrection = {
			id: "entry-linked-correction",
			timestamp: new Date("2026-05-11T08:30:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: false,
		};
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: { timeCorrection: { clockInCorrectionId: linkedCorrection.id } },
		});
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([correction]) }),
		} as never);
		vi.mocked(dbService.db.query.timeEntry.findFirst).mockResolvedValueOnce(linkedCorrection);

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.db.query.timeEntry.findFirst).toHaveBeenCalled();
		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
	});

	it("rejects a legacy pending correction without metadata when one active correction is unambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});

		await runTimeCorrectionDecisionEffect(
			rejectTimeCorrectionWithCurrentApproverEffect(
				dbService,
				timeCorrectionCurrentApprover,
				"period-1",
				"Incorrect correction",
			),
		);

		expect(dbService.updateSets).toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
	});

	it("does not roll back legacy pending corrections without metadata when active corrections are ambiguous", async () => {
		const dbService = createTimeCorrectionDecisionDbService();
		const secondCorrection = {
			id: "entry-second-correction",
			timestamp: new Date("2026-05-11T08:45:00.000Z"),
			replacesEntryId: "entry-original",
			isSuperseded: false,
		};
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-1",
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			metadata: null,
		});
		vi.mocked(dbService.db.select).mockReturnValueOnce({
			from: vi
				.fn()
				.mockReturnValue({ where: vi.fn().mockResolvedValue([correction, secondCorrection]) }),
		} as never);

		await expect(
			runTimeCorrectionDecisionEffect(
				rejectTimeCorrectionWithCurrentApproverEffect(
					dbService,
					timeCorrectionCurrentApprover,
					"period-1",
					"Incorrect correction",
				),
			),
		).rejects.toThrow("ambiguous legacy time correction approval");

		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: false, supersededById: null }]),
		);
		expect(dbService.updateSets).not.toEqual(
			expect.arrayContaining([{ isSuperseded: true, supersededById: null }]),
		);
	});
});

describe("time correction approval policy resolution", () => {
	it("forces time correction decisions through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { approveTimeCorrectionWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		approveTimeCorrectionWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
			},
			"period-1",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"time_entry",
			"period-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces time correction rejections through the transactional approval path", async () => {
		vi.resetModules();
		const processApprovalWithCurrentEmployee = vi.fn(() => Effect.void);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApprovalWithCurrentEmployee,
			processApproval: vi.fn(),
		}));
		const { rejectTimeCorrectionWithCurrentApproverEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		rejectTimeCorrectionWithCurrentApproverEffect(
			{} as ApprovalDbService,
			{
				id: "emp-manager",
				userId: "user-manager",
				organizationId: "org-1",
				user: { id: "user-manager", name: "Manager", email: "manager@example.com", image: null },
			},
			"period-1",
			"Incorrect shift",
		);

		expect(processApprovalWithCurrentEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			"time_entry",
			"period-1",
			"reject",
			"Incorrect shift",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces exported time correction approval actions through the transactional process path", async () => {
		vi.resetModules();
		const processApproval = vi.fn().mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval,
			processApprovalWithCurrentEmployee: vi.fn(),
		}));
		const { approveTimeCorrectionEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		await approveTimeCorrectionEffect("period-1");

		expect(processApproval).toHaveBeenCalledWith(
			"time_entry",
			"period-1",
			"approve",
			undefined,
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("forces exported time correction rejection actions through the transactional process path", async () => {
		vi.resetModules();
		const processApproval = vi.fn().mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/shared", () => ({
			processApproval,
			processApprovalWithCurrentEmployee: vi.fn(),
		}));
		const { rejectTimeCorrectionEffect } = await import(
			"@/lib/approvals/server/time-correction-approvals"
		);

		await rejectTimeCorrectionEffect("period-1", "Incorrect shift");

		expect(processApproval).toHaveBeenCalledWith(
			"time_entry",
			"period-1",
			"reject",
			"Incorrect shift",
			expect.any(Function),
			undefined,
			expect.objectContaining({ transactional: true }),
		);
		vi.doUnmock("@/lib/approvals/server/shared");
	});

	it("creates time correction approvals through the shared policy resolver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			createTimeCorrectionApprovalWorkflow(dbService, {
				organizationId: "org-1",
				requesterEmployeeId: "emp-requester",
				teamId: "team-1",
				workPeriodId: "period-1",
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
				overtimeRisk: "warning",
				correctionEntryIds: {
					clockInCorrectionId: "entry-correction",
					clockOutCorrectionId: "entry-clock-out-correction",
				},
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Correct missed clock-in",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: "entry-correction",
					clockOutCorrectionId: "entry-clock-out-correction",
				},
			},
		});
	});

	it("rejects a new time correction approval when the work period already has one pending", async () => {
		const { dbService } = createPolicyResolutionDbService([]);
		vi.mocked(dbService.db.query.approvalRequest.findFirst).mockResolvedValueOnce({
			id: "approval-existing",
		});

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Correct missed clock-in",
					overtimeRisk: "warning",
				}),
			),
		).rejects.toThrow("A time correction approval is already pending for this work period");
	});

	it("uses existing default approval behavior when no approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: timePolicyContext,
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
			}),
		);

		expect(result).toEqual({ kind: "default_created", approvalRequestId: "insert-1" });
		expect(inserts).toHaveLength(1);
		expect(inserts[0].values).toMatchObject({
			organizationId: "org-1",
			entityType: "time_entry",
			entityId: "period-1",
			requestedBy: "emp-requester",
			approverId: "emp-manager",
			status: "pending",
			reason: "Correct missed clock-in",
		});
	});

	it("creates a chain approval request when an approval policy matches", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Overtime policy",
				isActive: true,
				priority: 1,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", valueJson: "time_entry" },
					{ conditionType: "overtime_risk", operator: "equals", overtimeRisk: "warning" },
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Manager",
						approverType: "direct_manager",
						approverEmployeeId: null,
					},
				],
			},
		]);

		const result = await Effect.runPromise(
			resolvePolicyAndCreateApproval(dbService, {
				context: timePolicyContext,
				defaultApproverId: "emp-manager",
				reason: "Correct missed clock-in",
			}),
		);

		expect(result).toEqual({
			kind: "chain_created",
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
		});
		expect(inserts).toHaveLength(3);
		expect(inserts.map((insert) => insert.values.organizationId)).toEqual([
			"org-1",
			"org-1",
			"org-1",
		]);
		expect(inserts[0].values).toMatchObject({ policyId: "policy-1", entityType: "time_entry" });
		expect(inserts[1].values).toMatchObject({ approverId: "emp-manager", entityId: "period-1" });
		expect(inserts[2].values).toMatchObject({
			chainInstanceId: "insert-1",
			approvalRequestId: "insert-2",
			resolvedApproverEmployeeId: "emp-manager",
		});
	});

	it("fails closed when a matched time policy cannot resolve an approver", async () => {
		const { dbService, inserts } = createPolicyResolutionDbService([
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Broken time policy",
				isActive: true,
				priority: 1,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", valueJson: "time_entry" },
				],
				stages: [
					{
						id: "stage-1",
						stepOrder: 1,
						label: "Missing approver",
						approverType: "specific_employee",
						approverEmployeeId: "missing-employee",
					},
				],
			},
		]);

		await expect(
			Effect.runPromise(
				createTimeCorrectionApprovalWorkflow(dbService, {
					organizationId: "org-1",
					requesterEmployeeId: "emp-requester",
					teamId: "team-1",
					workPeriodId: "period-1",
					defaultApproverId: "emp-manager",
					reason: "Correct missed clock-in",
					overtimeRisk: "warning",
				}),
			),
		).rejects.toThrow("Specific approver is not active in this organization.");
		expect(inserts).toHaveLength(0);
	});
});
