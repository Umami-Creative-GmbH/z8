import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createNotification: vi.fn(),
	createNotificationForManager: vi.fn(),
	loadOrganizationTimezone: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.loadOrganizationTimezone,
}));
vi.mock("./notification-service", () => ({
	createNotification: mocks.createNotification,
	createNotificationForManager: mocks.createNotificationForManager,
}));

import {
	onComplianceExceptionApproved,
	onComplianceExceptionExpired,
	onComplianceExceptionRejected,
	onComplianceExceptionRequested,
	onOvertimeViolation,
	onOvertimeWarning,
	onRestPeriodViolation,
	onRestPeriodWarning,
} from "./compliance-triggers";

type Created = {
	title: string;
	message: string;
	metadata: {
		i18n: {
			titleKey: string;
			titleDefault: string;
			messageKey: string;
			messageDefault: string;
			params?: Record<string, unknown>;
		};
	};
};

function created(mock = mocks.createNotification): Created {
	const call = mock.mock.calls.at(-1);
	if (!call) throw new Error("No notification was created");
	return call[0];
}

const EXCEPTION_TYPE_SELECT =
	"{exceptionType, select, rest_period {rest period} overtime_daily {daily overtime} overtime_weekly {weekly overtime} overtime_monthly {monthly overtime} other {compliance}}";

describe("compliance notification triggers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadOrganizationTimezone.mockResolvedValue("Europe/Berlin");
	});

	it("asks the manager about a requested exception with a translatable type label", async () => {
		await onComplianceExceptionRequested({
			exceptionId: "exception-1",
			employeeId: "employee-1",
			employeeName: "Ada Lovelace",
			organizationId: "org-1",
			exceptionType: "overtime_weekly",
			reason: "Release week",
			managerId: "manager-1",
		});

		const notification = created(mocks.createNotificationForManager);
		expect(notification).toMatchObject({
			managerId: "manager-1",
			title: "Compliance exception requested",
			message: 'Ada Lovelace requested a weekly overtime exception: "Release week"',
		});
		expect(notification.metadata.i18n).toEqual({
			titleKey: "common:notifications.content.complianceExceptionRequested.title",
			titleDefault: "Compliance exception requested",
			messageKey: "common:notifications.content.complianceExceptionRequested.message",
			messageDefault: `{employeeName} requested a ${EXCEPTION_TYPE_SELECT} exception: "{reason}"`,
			params: {
				employeeName: "Ada Lovelace",
				exceptionType: "overtime_weekly",
				reason: "Release week",
			},
		});
	});

	it("shows the approval's end in the organization's zone, whatever the server zone", async () => {
		vi.stubEnv("TZ", "Pacific/Honolulu");
		try {
			await onComplianceExceptionApproved({
				exceptionId: "exception-1",
				employeeUserId: "user-1",
				employeeName: "Ada Lovelace",
				organizationId: "org-1",
				exceptionType: "rest_period",
				approverName: "Morgan Manager",
				validUntil: new Date("2026-10-14T16:30:00.000Z"),
			});
		} finally {
			vi.unstubAllEnvs();
		}

		const notification = created();
		expect(notification.message).toBe(
			"Your rest period exception was approved by Morgan Manager. Valid until Oct 14, 2026, 6:30 PM (Europe/Berlin).",
		);
		expect(mocks.loadOrganizationTimezone).toHaveBeenCalledWith({}, "org-1");
		expect(notification.metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.complianceExceptionApproved.title",
			messageKey: "common:notifications.content.complianceExceptionApproved.message",
			params: {
				exceptionType: "rest_period",
				approverName: "Morgan Manager",
				validUntil: {
					kind: "zonedInstant",
					at: "2026-10-14T16:30:00Z",
					timeZone: "Europe/Berlin",
				},
			},
		});
	});

	it.each([
		[
			undefined,
			"complianceExceptionRejected.message",
			"Your daily overtime exception was rejected by Morgan Manager.",
		],
		[
			"Not justified",
			"complianceExceptionRejected.messageWithReason",
			'Your daily overtime exception was rejected by Morgan Manager. Reason: "Not justified"',
		],
	])("translates a rejected exception (reason %s)", async (reason, key, message) => {
		await onComplianceExceptionRejected({
			exceptionId: "exception-1",
			employeeUserId: "user-1",
			employeeName: "Ada Lovelace",
			organizationId: "org-1",
			exceptionType: "overtime_daily",
			approverName: "Morgan Manager",
			reason,
		});

		const notification = created();
		expect(notification.message).toBe(message);
		expect(notification.metadata.i18n.messageKey).toBe(`common:notifications.content.${key}`);
	});

	it("translates an expired exception", async () => {
		await onComplianceExceptionExpired({
			exceptionId: "exception-1",
			employeeUserId: "user-1",
			employeeName: "Ada Lovelace",
			organizationId: "org-1",
			exceptionType: "overtime_monthly",
		});

		const notification = created();
		expect(notification.message).toBe(
			"Your monthly overtime pre-approval has expired (24 hours passed without use).",
		);
		expect(notification.metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.complianceExceptionExpired.title",
			messageKey: "common:notifications.content.complianceExceptionExpired.message",
			params: { exceptionType: "overtime_monthly" },
		});
	});

	it("warns about the rest period with a typed duration and clock-in time", async () => {
		await onRestPeriodWarning({
			employeeUserId: "user-1",
			organizationId: "org-1",
			hoursRemaining: 2.5,
			nextAllowedClockIn: new Date("2026-10-14T05:00:00.000Z"),
		});

		const notification = created();
		expect(notification.message).toBe(
			"You have 2 hours 30 minutes of required rest remaining. Next allowed clock-in: Oct 14, 2026, 7:00 AM (Europe/Berlin).",
		);
		expect(notification.metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.restPeriodWarning.title",
			messageKey: "common:notifications.content.restPeriodWarning.message",
			params: {
				remaining: { kind: "duration", minutes: 150 },
				nextAllowedClockIn: {
					kind: "zonedInstant",
					at: "2026-10-14T05:00:00Z",
					timeZone: "Europe/Berlin",
				},
			},
		});
	});

	it("warns about approaching overtime with a translatable period", async () => {
		await onOvertimeWarning({
			employeeUserId: "user-1",
			organizationId: "org-1",
			overtimeType: "weekly",
			currentMinutes: 2580,
			thresholdMinutes: 2880,
			percentOfThreshold: 89.6,
		});

		const notification = created();
		expect(notification.message).toBe(
			"You've worked 43 hours this week (90% of the 48 hours limit).",
		);
		expect(notification.metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.overtimeWarning.title",
			messageKey: "common:notifications.content.overtimeWarning.message",
			params: {
				period: "weekly",
				worked: { kind: "duration", minutes: 2580 },
				limit: { kind: "duration", minutes: 2880 },
				percent: 90,
			},
		});
		expect(notification.metadata.i18n.messageDefault).toContain(
			"{period, select, daily {today} weekly {this week} other {this month}}",
		);
	});

	it.each([
		[onRestPeriodViolation, "restPeriodViolation", "Rest period violation logged"],
		[onOvertimeViolation, "overtimeViolation", "Overtime violation logged"],
	])(
		"translates the %#. violation title and keeps its description",
		async (trigger, key, title) => {
			await trigger({
				employeeUserId: "user-1",
				organizationId: "org-1",
				violationType: "x",
				description: "Worked 11h without a break",
			});

			const notification = created();
			expect(notification).toMatchObject({ title, message: "Worked 11h without a break" });
			expect(notification.metadata.i18n).toMatchObject({
				titleKey: `common:notifications.content.${key}.title`,
				messageKey: `common:notifications.content.${key}.message`,
				params: { description: "Worked 11h without a break" },
			});
		},
	);
});
