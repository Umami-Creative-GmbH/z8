import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, ValidationError } from "@/lib/effect/errors";
import { ShiftRequestService } from "@/lib/effect/services/shift-request.service";

const mocks = vi.hoisted(() => ({
	requestPickup: vi.fn(),
	createNotification: vi.fn(),
	employeeFindFirst: vi.fn(),
	managerRecipients: vi.fn(),
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
			shift: { findFirst: mocks.shiftFindFirst },
		},
	},
}));

vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: mocks.createNotification,
}));

vi.mock("@/lib/notifications/manager-notice-recipients", () => ({
	currentRosterManagerRecipients: mocks.managerRecipients,
}));

// The bot submits through the shift request service; the fake stands in for its outcome.
vi.mock("@/lib/effect/runtime", () => ({
	runtime: {
		runPromise: <A, E>(effect: Effect.Effect<A, E, ShiftRequestService>) =>
			Effect.runPromise(
				effect.pipe(
					Effect.provide(
						Layer.succeed(
							ShiftRequestService,
							ShiftRequestService.of({ requestPickup: mocks.requestPickup } as never),
						),
					),
				),
			),
	},
}));

import {
	handleShiftPickupAction,
	notifyPrimaryManagerAboutShiftPickup,
} from "./shift-pickup-handler";

describe("handleShiftPickupAction (#1597)", () => {
	const sendActivity = vi.fn();
	const context = { sendActivity } as never;
	const tenant = { tenantId: "tenant-1", organizationId: "org-1" } as never;
	const replies = () => sendActivity.mock.calls.map(([activity]) => activity.text as string);

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
		mocks.managerRecipients.mockResolvedValue({ userIds: ["manager-user-1"], reason: "managers" });
		mocks.employeeFindFirst.mockResolvedValue({ userId: "requester-user", firstName: "Ada" });
		mocks.shiftFindFirst.mockResolvedValue({
			date: new Date("2026-06-01T22:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
		});
	});

	it("submits the pickup through the shift request service and asks the manager to review it", async () => {
		mocks.requestPickup.mockReturnValue(Effect.succeed({ id: "request-1", status: "pending" }));

		await handleShiftPickupAction(context, "shift-1", "employee-1", tenant);

		expect(mocks.requestPickup).toHaveBeenCalledWith("org-1", {
			shiftId: "shift-1",
			requesterId: "employee-1",
		});
		expect(replies()).toEqual([expect.stringContaining("Shift pickup request submitted")]);
		expect(mocks.createNotification).toHaveBeenCalledOnce();
	});

	it("tells the only decider their pickup is approved and asks nobody to review it", async () => {
		mocks.requestPickup.mockReturnValue(Effect.succeed({ id: "request-1", status: "approved" }));

		await handleShiftPickupAction(context, "shift-1", "employee-1", tenant);

		expect(replies()).toEqual([expect.stringContaining("Shift picked up")]);
		expect(mocks.createNotification).not.toHaveBeenCalled();
	});

	it("says the shift is no longer available when it was assigned meanwhile", async () => {
		mocks.requestPickup.mockReturnValue(
			Effect.fail(
				new ValidationError({
					message: "This shift is already assigned. Use swap request instead.",
					field: "employeeId",
				}),
			),
		);

		await handleShiftPickupAction(context, "shift-1", "employee-1", tenant);

		expect(replies()).toEqual([expect.stringContaining("Shift no longer available")]);
	});

	it("sends the only decider to the planner when they lack a required skill for the shift", async () => {
		mocks.requestPickup.mockReturnValue(
			Effect.fail(
				new ValidationError({
					message: "Give a reason to assign an employee without every required skill",
					field: "skillOverrideReason",
				}),
			),
		);

		await handleShiftPickupAction(context, "shift-1", "employee-1", tenant);

		expect(replies()).toEqual([expect.stringContaining("Required skill missing")]);
	});

	it("says a pickup is already pending for a duplicate request", async () => {
		mocks.requestPickup.mockReturnValue(
			Effect.fail(
				new ConflictError({
					message: "You already have a pending request for this shift",
					conflictType: "duplicate_request",
				}),
			),
		);

		await handleShiftPickupAction(context, "shift-1", "employee-1", tenant);

		expect(replies()).toEqual([expect.stringContaining("Request already pending")]);
	});
});

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
			mocks.managerRecipients.mockResolvedValue({
				userIds: ["manager-user-1"],
				reason: "managers",
			});
			mocks.employeeFindFirst.mockResolvedValue({
				userId: "requester-user",
				firstName: "Ada",
				lastName: "Lovelace",
			});
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
					recipientReason: "managers",
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
		mocks.managerRecipients.mockResolvedValue({ userIds: ["manager-user-1"], reason: "managers" });
		mocks.employeeFindFirst.mockResolvedValue({
			userId: "requester-user",
			firstName: null,
			lastName: null,
		});
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

	function pickupData() {
		mocks.loadOrganizationTimezone.mockResolvedValue("UTC");
		mocks.employeeFindFirst.mockResolvedValue({
			userId: "requester-user",
			firstName: "Ada",
			lastName: "Lovelace",
		});
		mocks.shiftFindFirst.mockResolvedValue({
			date: new Date("2026-06-02T00:00:00.000Z"),
			startTime: "09:00",
			endTime: "17:00",
		});
	}

	const notify = () =>
		notifyPrimaryManagerAboutShiftPickup({
			requestId: "request-1",
			shiftId: "shift-1",
			requesterId: "employee-1",
			organizationId: "org-1",
		});

	it("asks for the current primary manager as an actionable notice, never the requester (#1438)", async () => {
		pickupData();
		mocks.managerRecipients.mockResolvedValue({ userIds: ["manager-user-1"], reason: "managers" });

		await notify();

		expect(mocks.managerRecipients).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			employeeIds: ["employee-1"],
			notice: "actionable",
			primaryOnly: true,
			excludeUserIds: ["requester-user"],
		});
	});

	it("asks the organization's admins when the primary manager is a former employee", async () => {
		pickupData();
		mocks.managerRecipients.mockResolvedValue({
			userIds: ["admin-user-1", "owner-user-1"],
			reason: "organization_admins",
		});

		await notify();

		expect(mocks.createNotification.mock.calls.map(([params]) => params.userId)).toEqual([
			"admin-user-1",
			"owner-user-1",
		]);
		expect(mocks.createNotification.mock.calls[0]?.[0].metadata).toMatchObject({
			recipientReason: "organization_admins",
		});
	});

	it("notifies nobody when no one can receive the request", async () => {
		pickupData();
		mocks.managerRecipients.mockResolvedValue({ userIds: [], reason: "none" });

		await notify();

		expect(mocks.createNotification).not.toHaveBeenCalled();
	});
});
