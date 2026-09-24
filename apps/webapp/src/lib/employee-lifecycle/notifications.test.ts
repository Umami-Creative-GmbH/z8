import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { NotificationChannel } from "@/lib/notifications/types";
import { buildReviewNotification, planReviewNotificationDeliveries } from "./notifications";

function channels(disabled: NotificationChannel[] = []): Record<NotificationChannel, boolean> {
	const all: NotificationChannel[] = [
		"in_app",
		"push",
		"email",
		"teams",
		"telegram",
		"discord",
		"slack",
	];
	return Object.fromEntries(all.map((channel) => [channel, !disabled.includes(channel)])) as Record<
		NotificationChannel,
		boolean
	>;
}

describe("planReviewNotificationDeliveries", () => {
	it("plans one delivery per recipient and enabled channel and records opt-outs separately", () => {
		const plan = planReviewNotificationDeliveries(
			[
				{ userId: "admin", reason: "organization_admin" },
				{ userId: "manager", reason: "primary_manager" },
			],
			new Map([
				["admin", channels(["email", "push", "teams", "telegram", "discord", "slack"])],
				["manager", channels(["in_app", "push", "teams", "telegram", "discord", "slack"])],
			]),
		);

		expect(plan.deliveries).toEqual([
			{ recipientUserId: "admin", channel: "in_app" },
			{ recipientUserId: "manager", channel: "email" },
		]);
		expect(plan.suppressed).toContainEqual({ recipientUserId: "admin", channel: "email" });
		expect(plan.suppressed).toContainEqual({ recipientUserId: "manager", channel: "in_app" });
	});

	it("skips a recipient whose preferences could not be loaded", () => {
		expect(
			planReviewNotificationDeliveries(
				[{ userId: "gone", reason: "organization_admin" }],
				new Map(),
			),
		).toEqual({ deliveries: [], suppressed: [] });
	});
});

describe("buildReviewNotification", () => {
	const base = {
		organizationId: "org-1",
		recipientUserId: "user-1",
		review: {
			id: "10000000-0000-4000-8000-000000000001",
			kind: "clock_out" as const,
			employeeId: "20000000-0000-4000-8000-000000000001",
		},
		employeeName: "Avery",
		// 00:00 on 1 October in Berlin, still 30 September in UTC.
		cutoff: parseInstant("2026-09-30T22:00:00Z"),
		timezone: "Europe/Berlin",
	};

	it("formats the cutoff in the departure's frozen zone and the recipient's locale", () => {
		const german = buildReviewNotification({ ...base, locale: "de" });
		const english = buildReviewNotification({ ...base, locale: "en" });

		expect(german.message).toContain("01.10.2026");
		expect(german.message).toContain("Europe/Berlin");
		expect(english.message).toContain("Oct 1, 2026");
		expect(english.message).not.toContain("Sep 30");
	});

	it("links the exact persisted review with a stable per-recipient idempotency key", () => {
		const notification = buildReviewNotification({ ...base, locale: "en" });

		expect(notification).toMatchObject({
			type: "employee_offboarding_review",
			title: "Employee offboarding needs review",
			entityType: "employee_departure_review",
			entityId: base.review.id,
			actionUrl: `/settings/employees/${base.review.employeeId}?review=${base.review.id}`,
			idempotencyKey: `offboarding-review:${base.review.id}:user-1`,
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.employeeOffboardingReview.title",
					messageKey: "common:notifications.content.employeeOffboardingReview.clock_out",
				},
			},
		});
		expect(notification.message).toContain("Needs review: offboarding clock-out");
	});
});
