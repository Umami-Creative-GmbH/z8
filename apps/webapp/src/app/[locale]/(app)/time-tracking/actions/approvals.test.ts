import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	findWorkPeriod: vi.fn(),
	findTimeEntries: vi.fn(),
	onClockOutPendingApproval: vi.fn(),
	onClockOutPendingApprovalToManager: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mocks.findEmployee },
			workPeriod: { findFirst: mocks.findWorkPeriod },
			timeEntry: { findMany: mocks.findTimeEntries },
		},
	},
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onClockOutPendingApproval: mocks.onClockOutPendingApproval,
	onClockOutPendingApprovalToManager: mocks.onClockOutPendingApprovalToManager,
	onManualEntryApproved: vi.fn(),
}));

const source = readFileSync(
	fileURLToPath(new URL("./approvals.ts", import.meta.url)),
	"utf8",
);

describe("ordinary approval ownership", () => {
	it("contains notification delivery only", () => {
		expect(source).not.toContain("resolvePolicyAndCreateApproval");
		expect(source).not.toContain("createTimeEntryApprovalRequest");
		expect(source).not.toContain("createClockOutApprovalRequest");
		expect(source).not.toContain("createManualEntryApprovalRequest");
		expect(source).not.toContain(".insert(approvalRequest)");
	});
});

describe("ordinary approval notifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findWorkPeriod.mockResolvedValue(undefined);
		mocks.findTimeEntries.mockResolvedValue([]);
		mocks.onClockOutPendingApproval.mockResolvedValue(undefined);
		mocks.onClockOutPendingApprovalToManager.mockResolvedValue(undefined);
		mocks.findEmployee
			.mockResolvedValueOnce({
				userId: "user-employee",
				user: { name: "Avery" },
			})
			.mockResolvedValueOnce({ userId: "user-manager" });
	});

	it("awaits both durable pending notifications with stable distinct keys", async () => {
		let resolveEmployee!: () => void;
		let resolveManager!: () => void;
		mocks.onClockOutPendingApproval.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveEmployee = resolve;
			}),
		);
		mocks.onClockOutPendingApprovalToManager.mockReturnValue(
			new Promise<void>((resolve) => {
				resolveManager = resolve;
			}),
		);
		const { sendManualEntryApprovalNotifications } = await import("./approvals");
		let settled = false;
		const pending = sendManualEntryApprovalNotifications({
			workPeriodId: "period-1",
			employeeId: "employee-1",
			managerId: "manager-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-11T08:00:00.000Z"),
			endTime: new Date("2026-05-11T16:00:00.000Z"),
			durationMinutes: 480,
			dedupeKey: "submission:default_created",
		}).then(() => {
			settled = true;
		});

		await vi.waitFor(() => {
			expect(mocks.onClockOutPendingApproval).toHaveBeenCalledOnce();
			expect(mocks.onClockOutPendingApprovalToManager).toHaveBeenCalledOnce();
		});
		expect(mocks.onClockOutPendingApproval).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "submission:default_created:employee:pending",
				durable: true,
			}),
		);
		expect(mocks.onClockOutPendingApprovalToManager).toHaveBeenCalledWith(
			expect.objectContaining({
				idempotencyKey: "submission:default_created:manager:pending",
				durable: true,
				times: null,
			}),
		);
		resolveEmployee();
		await Promise.resolve();
		expect(settled).toBe(false);
		resolveManager();
		await pending;
		expect(settled).toBe(true);
	});

	it("passes the period's times at the offsets stored on its own entries (#1153)", async () => {
		mocks.findWorkPeriod.mockResolvedValue({ clockInId: "entry-in", clockOutId: "entry-out" });
		mocks.findTimeEntries.mockResolvedValue([
			{
				id: "entry-out",
				timestamp: new Date("2026-05-11T04:45:00.000Z"),
				utcOffsetMinutes: 180,
			},
			{
				id: "entry-in",
				timestamp: new Date("2026-05-10T20:30:00.000Z"),
				utcOffsetMinutes: 120,
			},
		]);
		const { sendManualEntryApprovalNotifications } = await import("./approvals");

		await sendManualEntryApprovalNotifications({
			workPeriodId: "period-1",
			employeeId: "employee-1",
			managerId: "manager-1",
			organizationId: "org-1",
			startTime: new Date("2026-05-10T20:30:00.000Z"),
			endTime: new Date("2026-05-11T04:45:00.000Z"),
			durationMinutes: 495,
			dedupeKey: "submission:default_created",
		});

		const times = {
			clockIn: { at: new Date("2026-05-10T20:30:00.000Z"), utcOffsetMinutes: 120 },
			clockOut: { at: new Date("2026-05-11T04:45:00.000Z"), utcOffsetMinutes: 180 },
		};
		expect(mocks.onClockOutPendingApproval).toHaveBeenCalledWith(
			expect.objectContaining({ times }),
		);
		expect(mocks.onClockOutPendingApprovalToManager).toHaveBeenCalledWith(
			expect.objectContaining({ times }),
		);
		expect(mocks.findWorkPeriod).toHaveBeenCalledOnce();
		expect(mocks.findTimeEntries).toHaveBeenCalledOnce();
	});
});
