import { beforeEach, describe, expect, it, vi } from "vitest";

const { amend, amendLegacy, replay, admission } = vi.hoisted(() => ({
	amend: vi.fn(),
	amendLegacy: vi.fn(),
	replay: vi.fn(),
	admission: { current: "append" as "append" | "legacy" },
}));
vi.mock("./completed-work-transaction", () => ({
	withCompletedWorkTransaction: async (
		_input: unknown,
		callback: (scope: unknown) => unknown,
	) => callback({ admission: admission.current }),
}));
vi.mock("./amend-completed-work", async (importOriginal) => ({
	...(await importOriginal<typeof import("./amend-completed-work")>()),
	replayOrAmendCompletedWork: amend,
	amendLegacyCompletedWork: amendLegacy,
	replayCommittedAmendment: replay,
}));

import {
	applyAdminWorkPeriodTimeEdit,
	replayAdminWorkPeriodTimeEdit,
} from "./admin-work-period-time-edit";

const input = {
	organizationId: "org",
	actorUserId: "actor",
	workPeriodId: "period",
	submissionId: "submission",
	submitted: {
		clockInDate: "2026-09-01",
		clockInTime: "09:00",
		clockOutDate: "2026-09-01",
		clockOutTime: "17:00",
		workLocationType: "home" as const,
	},
	expected: {
		employeeId: "employee",
		clockInId: "in",
		clockOutId: "out",
		startTime: new Date("2026-09-01T07:00Z"),
		endTime: new Date("2026-09-01T15:00Z"),
	},
	clockIn: new Date("2026-09-01T07:00Z"),
	clockOut: new Date("2026-09-01T15:00Z"),
	timezone: "Europe/Berlin",
	timezoneSource: "user_setting" as const,
	notes: "Worked at home",
	ipAddress: "",
	deviceInfo: "",
};

describe("admin calendar location amendments", () => {
	beforeEach(() => {
		admission.current = "append";
	});

	it("amends legacy work through the same amendment, without a receipt (#1226)", async () => {
		admission.current = "legacy";
		amendLegacy.mockResolvedValue({ result: { workPeriodId: "period" } });
		amend.mockClear();
		await expect(applyAdminWorkPeriodTimeEdit(input)).resolves.toEqual({
			workPeriodId: "period",
			employeeId: "employee",
		});
		expect(amend).not.toHaveBeenCalled();
		expect(amendLegacy).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				authority: "organization_admin",
				writer: "admin_time_edit",
				intent: expect.objectContaining({ workLocation: { kind: "replace", id: "home" } }),
			}),
		);
	});

	it("preserves unchanged instants and timezone captures with sub-minute precision", async () => {
		amend.mockResolvedValue({ result: { workPeriodId: "period" } });
		const clockIn = new Date("2025-10-26T01:30:20Z");
		const clockOut = new Date("2025-10-26T01:30:40Z");
		await applyAdminWorkPeriodTimeEdit({
			...input,
			clockIn,
			clockOut,
			expected: { ...input.expected, startTime: clockIn, endTime: clockOut },
		});
		expect(amend).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({
				intent: expect.objectContaining({
					clockIn: { kind: "preserve" },
					clockOut: { kind: "preserve" },
				}),
			}),
		);
	});
	it("includes the location in the atomic amendment and its replay identity", async () => {
		amend.mockResolvedValue({ result: { workPeriodId: "period" } });
		replay.mockResolvedValue(null);
		await applyAdminWorkPeriodTimeEdit(input);
		expect(amend).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				intent: expect.objectContaining({
					workLocation: { kind: "replace", id: "home" },
				}),
				command: expect.objectContaining({
					request: expect.objectContaining({ workLocationType: "home" }),
				}),
			}),
		);
		await replayAdminWorkPeriodTimeEdit(input);
		expect(replay).toHaveBeenCalledWith(
			expect.objectContaining({
				command: expect.objectContaining({
					request: expect.objectContaining({ workLocationType: "home" }),
				}),
			}),
		);
	});
});
