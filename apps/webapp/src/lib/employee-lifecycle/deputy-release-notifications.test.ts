import { describe, expect, it, vi } from "vitest";
import type { AuditTrail } from "@/lib/audit-trail";
import {
	buildDeputyUnavailableNotification,
	notifyDeputyUnavailableAfterCommit,
} from "./deputy-release-notifications";

const base = {
	organizationId: "org-1",
	recipientUserId: "user-anna",
	absence: { id: "absence-1", startDate: "2026-10-01", endDate: "2026-10-05" },
	absentEmployeeName: "Anna",
	deputyName: "Lea",
	eventKey: "departure-1",
	locale: "en",
};

describe("buildDeputyUnavailableNotification", () => {
	it("tells the absent employee that their deputy is no longer available, with plain dates", () => {
		const notification = buildDeputyUnavailableNotification({
			...base,
			audience: "absent_employee",
		});

		expect(notification).toMatchObject({
			userId: "user-anna",
			organizationId: "org-1",
			type: "absence_deputy_unavailable",
			title: "Deputy no longer available",
			message:
				"Lea is no longer available as deputy for your absence from Oct 1, 2026 to Oct 5, 2026.",
			entityType: "absence_entry",
			entityId: "absence-1",
			actionUrl: "/absences",
			idempotencyKey: "deputy-unavailable:absence-1:departure-1:user-anna",
		});
		expect(notification.metadata?.i18n).toEqual({
			titleKey: "common:notifications.content.absenceDeputyUnavailable.title",
			titleDefault: "Deputy no longer available",
			messageKey: "common:notifications.content.absenceDeputyUnavailable.message",
			messageDefault:
				"{deputyName} is no longer available as deputy for your absence from {startDate} to {endDate}.",
			params: { deputyName: "Lea", startDate: "Oct 1, 2026", endDate: "Oct 5, 2026" },
		});
	});

	it("names the absent employee for their managers and links to team absences", () => {
		const notification = buildDeputyUnavailableNotification({
			...base,
			recipientUserId: "user-mia",
			audience: "manager",
			locale: "de",
		});

		expect(notification).toMatchObject({
			userId: "user-mia",
			message:
				"Lea is no longer available as deputy for Anna's absence from 1. Okt. 2026 to 5. Okt. 2026.",
			actionUrl: "/team/absences?year=2026",
			idempotencyKey: "deputy-unavailable:absence-1:departure-1:user-mia",
		});
		expect(notification.metadata?.i18n).toMatchObject({
			messageKey: "common:notifications.content.absenceDeputyUnavailable.managerMessage",
			messageDefault:
				"{deputyName} is no longer available as deputy for {employeeName}'s absence from {startDate} to {endDate}.",
			params: {
				deputyName: "Lea",
				employeeName: "Anna",
				startDate: "1. Okt. 2026",
				endDate: "5. Okt. 2026",
			},
		});
	});

	it("never mentions the absence category", () => {
		const notification = buildDeputyUnavailableNotification({ ...base, audience: "manager" });

		expect(JSON.stringify(notification)).not.toMatch(/categor|sick|vacation/i);
	});
});

describe("notifyDeputyUnavailableAfterCommit (#1014)", () => {
	it("forwards the release's audit entries to the external audit service, like a manual change", async () => {
		const forwardCommitted = vi.fn();
		await notifyDeputyUnavailableAfterCommit(
			{
				// Notifications fail here; the audit still goes out.
				database: {} as never,
				transport: { send: vi.fn(), locale: vi.fn() },
			},
			{
				organizationId: "org-1",
				deputyEmployeeId: "deputy-1",
				eventKey: "employee_deactivated:1",
				assignments: [
					{
						absenceId: "absence-1",
						absentEmployeeId: "anna",
						startDate: "2026-10-01",
						endDate: "2026-10-05",
					},
				],
				audit: { forwardCommitted } as unknown as AuditTrail,
			},
		);

		expect(forwardCommitted).toHaveBeenCalledOnce();
	});
});
