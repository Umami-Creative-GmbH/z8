import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createNotification: vi.fn(),
	employeeFindFirst: vi.fn(),
	employeeManagersFindFirst: vi.fn(),
	shiftFindFirst: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.loadOrganizationTimezone,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mocks.employeeFindFirst },
			employeeManagers: { findFirst: mocks.employeeManagersFindFirst },
			shift: { findFirst: mocks.shiftFindFirst },
		},
	},
}));

vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: mocks.createNotification,
}));

import { notifyPrimaryManagerAboutShiftPickup } from "./shift-pickup-handler";

describe("notifyPrimaryManagerAboutShiftPickup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		{ timezone: "Europe/Berlin", stored: "2026-06-01T22:00:00.000Z" },
		{ timezone: "America/New_York", stored: "2026-06-02T04:00:00.000Z" },
		{ timezone: "UTC", stored: "2026-06-02T00:00:00.000Z" },
	])(
		"notifies the requester's primary manager of a $timezone organization's shift date",
		async ({ timezone, stored }) => {
			mocks.loadOrganizationTimezone.mockResolvedValue(timezone);
			mocks.employeeManagersFindFirst.mockResolvedValue({ managerId: "manager-1" });
			mocks.employeeFindFirst
				.mockResolvedValueOnce({ firstName: "Ada", lastName: "Lovelace" })
				.mockResolvedValueOnce({ userId: "manager-user-1" });
			mocks.shiftFindFirst.mockResolvedValue({
				date: new Date(stored),
				startTime: "09:00",
				endTime: "17:00",
			});

			await notifyPrimaryManagerAboutShiftPickup({
				requestId: "request-1",
				shiftId: "shift-1",
				requesterId: "employee-1",
				organizationId: "org-1",
			});

			expect(mocks.createNotification).toHaveBeenCalledWith({
				userId: "manager-user-1",
				organizationId: "org-1",
				type: "shift_pickup_requested",
				title: "Shift pickup request",
				message: "Ada Lovelace requested to pick up the shift on Tue, Jun 2 (09:00 - 17:00).",
				entityType: "shift_request",
				entityId: "request-1",
				actionUrl: "/scheduling",
				metadata: {
					shiftId: "shift-1",
					requesterId: "employee-1",
					managerId: "manager-1",
					// Each channel formats the calendar date in the manager's language.
					i18n: {
						titleKey: "common:notifications.content.shiftPickupRequested.title",
						titleDefault: "Shift pickup request",
						messageKey: "common:notifications.content.shiftPickupRequested.message",
						messageDefault:
							"{requesterName} requested to pick up the shift on {shiftDate} ({startTime} - {endTime}).",
						params: {
							requesterName: "Ada Lovelace",
							shiftDate: { kind: "plainDate", date: "2026-06-02", preset: "weekdayMonthDay" },
							startTime: "09:00",
							endTime: "17:00",
						},
					},
				},
			});
		},
	);

	it("translates the request of a requester without a name", async () => {
		mocks.loadOrganizationTimezone.mockResolvedValue("UTC");
		mocks.employeeManagersFindFirst.mockResolvedValue({ managerId: "manager-1" });
		mocks.employeeFindFirst
			.mockResolvedValueOnce({ firstName: null, lastName: null })
			.mockResolvedValueOnce({ userId: "manager-user-1" });
		mocks.shiftFindFirst.mockResolvedValue({
			date: new Date("2026-06-02T00:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
		});

		await notifyPrimaryManagerAboutShiftPickup({
			requestId: "request-1",
			shiftId: "shift-1",
			requesterId: "employee-1",
			organizationId: "org-1",
		});

		const notification = mocks.createNotification.mock.calls[0]?.[0];
		expect(notification.message).toBe(
			"An employee requested to pick up the shift on Tue, Jun 2 (09:00 - 17:00).",
		);
		expect(notification.metadata.i18n).toMatchObject({
			messageKey: "common:notifications.content.shiftPickupRequested.messageUnnamedRequester",
			params: { startTime: "09:00", endTime: "17:00" },
		});
		expect(notification.metadata.i18n.params).not.toHaveProperty("requesterName");
	});
});
