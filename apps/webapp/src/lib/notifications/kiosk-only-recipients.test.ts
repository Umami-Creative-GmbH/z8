import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { forwardedNotification } from "./kiosk-only-recipients";

describe("forwardedNotification", () => {
	it("keeps the employee's own client details out of a manager's copy (#1180)", () => {
		const i18n = { titleKey: "common:notifications.content.passwordChanged.title" };
		const forwardedFor = { employeeId: "employee-1", name: "Kim Kiosk" };

		const copy = forwardedNotification(
			{
				userId: "user-kiosk",
				organizationId: "org-1",
				type: "password_changed",
				title: "Password changed",
				message: "Your password was successfully changed.",
				metadata: { i18n, ipAddress: "203.0.113.7", userAgent: "Synthetic Browser/1.0" },
			},
			forwardedFor,
			"user-manager",
		);

		expect(copy).toMatchObject({ userId: "user-manager", title: "Kim Kiosk: Password changed" });
		expect(copy.metadata).toEqual({ i18n, forwardedFor });
	});
});
