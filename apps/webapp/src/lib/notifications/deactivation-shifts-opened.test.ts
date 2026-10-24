import { beforeEach, describe, expect, it, vi } from "vitest";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));

vi.mock("./notification-service", () => ({ createNotification }));

import { onDeactivationShiftsOpened } from "./triggers";

describe("planner notice when a deactivation opens shifts (#1440)", () => {
	beforeEach(() => {
		createNotification.mockReset();
		createNotification.mockResolvedValue({ id: "notification-1" });
	});

	it("tells each planner once how many shifts are open, keyed by the deactivation", async () => {
		await onDeactivationShiftsOpened({
			organizationId: "org-1",
			deactivationId: "deactivation-1",
			employeeName: "Robin Leaver",
			shiftCount: 3,
			recipientUserIds: ["user-planner", "user-admin"],
		});

		expect(createNotification).toHaveBeenCalledTimes(2);
		expect(createNotification).toHaveBeenNthCalledWith(1, {
			userId: "user-planner",
			organizationId: "org-1",
			type: "employee_deactivation_shifts_opened",
			title: "Shifts need someone",
			message: "Robin Leaver was deactivated. 3 upcoming shifts are open now.",
			entityType: "employee_deactivation",
			entityId: "deactivation-1",
			actionUrl: "/scheduling",
			idempotencyKey: "deactivation-shifts:deactivation-1:user-planner",
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.employeeDeactivationShiftsOpened.title",
					titleDefault: "Shifts need someone",
					messageKey: "common:notifications.content.employeeDeactivationShiftsOpened.message",
					messageDefault:
						"{employeeName} was deactivated. {shiftCount, plural, one {# upcoming shift is} other {# upcoming shifts are}} open now.",
					params: { employeeName: "Robin Leaver", shiftCount: 3 },
				},
			},
		});
		expect(createNotification.mock.calls[1]?.[0]).toMatchObject({
			userId: "user-admin",
			idempotencyKey: "deactivation-shifts:deactivation-1:user-admin",
		});
	});

	it("uses the singular for one shift", async () => {
		await onDeactivationShiftsOpened({
			organizationId: "org-1",
			deactivationId: "deactivation-1",
			employeeName: "Robin Leaver",
			shiftCount: 1,
			recipientUserIds: ["user-planner"],
		});

		expect(createNotification.mock.calls[0]?.[0].message).toBe(
			"Robin Leaver was deactivated. 1 upcoming shift is open now.",
		);
	});

	it("sends nothing without shifts or recipients", async () => {
		await onDeactivationShiftsOpened({
			organizationId: "org-1",
			deactivationId: "deactivation-1",
			employeeName: "Robin Leaver",
			shiftCount: 0,
			recipientUserIds: ["user-planner"],
		});
		await onDeactivationShiftsOpened({
			organizationId: "org-1",
			deactivationId: "deactivation-1",
			employeeName: "Robin Leaver",
			shiftCount: 2,
			recipientUserIds: [],
		});

		expect(createNotification).not.toHaveBeenCalled();
	});

	it("keeps notifying the others when one notification fails", async () => {
		createNotification.mockRejectedValueOnce(new Error("down"));

		await expect(
			onDeactivationShiftsOpened({
				organizationId: "org-1",
				deactivationId: "deactivation-1",
				employeeName: "Robin Leaver",
				shiftCount: 2,
				recipientUserIds: ["user-a", "user-b"],
			}),
		).resolves.toBeUndefined();
		expect(createNotification).toHaveBeenCalledTimes(2);
	});
});
