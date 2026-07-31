import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	onClockOutPendingApproval: vi.fn(),
	onClockOutPendingApprovalToManager: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: { query: { employee: { findFirst: mocks.findEmployee } } },
}));

vi.mock("@/lib/notifications/triggers", () => ({
	onClockOutApproved: vi.fn(),
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
		const { sendClockOutApprovalNotifications } = await import("./approvals");
		let settled = false;
		const pending = sendClockOutApprovalNotifications({
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
			}),
		);
		resolveEmployee();
		await Promise.resolve();
		expect(settled).toBe(false);
		resolveManager();
		await pending;
		expect(settled).toBe(true);
	});
});
