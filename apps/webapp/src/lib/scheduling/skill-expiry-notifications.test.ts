import { describe, expect, it } from "vitest";
import { buildSkillExpiryReminderNotification } from "./skill-expiry-notifications";

const employeeSkill = {
	id: "es-1",
	employeeId: "emp-1",
	employeeName: "Anna Berg",
	skillName: "Forklift licence",
	expiryDate: "2026-11-30",
};

describe("buildSkillExpiryReminderNotification", () => {
	it("tells a manager whose skill expires soon and links to the employee's skills", () => {
		expect(
			buildSkillExpiryReminderNotification({
				organizationId: "org-1",
				recipientUserId: "manager-1",
				audience: "manager",
				kind: "upcoming",
				employeeSkill,
			}),
		).toEqual({
			userId: "manager-1",
			organizationId: "org-1",
			type: "skill_expiry_upcoming",
			title: "A skill expires soon",
			message: 'The skill "Forklift licence" of Anna Berg expires on 30 Nov 2026.',
			entityType: "employee_skill",
			entityId: "es-1",
			actionUrl: "/settings/employees/emp-1",
			idempotencyKey: "skill-expiry:es-1:upcoming:2026-11-30:manager-1",
			metadata: {
				employeeId: "emp-1",
				expiryDate: "2026-11-30",
				untilDay: "2026-11-30",
				i18n: {
					titleKey: "common:notifications.content.skillExpiryUpcoming.title",
					titleDefault: "A skill expires soon",
					messageKey: "common:notifications.content.skillExpiryUpcoming.message",
					messageDefault: 'The skill "{skill}" of {employee} expires on {untilDate}.',
					params: {
						skill: "Forklift licence",
						employee: "Anna Berg",
						untilDate: "30 Nov 2026",
					},
				},
			},
		});
	});

	it("tells the employee about their own skill on its expiry date and links to their profile", () => {
		const notification = buildSkillExpiryReminderNotification({
			organizationId: "org-1",
			recipientUserId: "anna",
			audience: "employee",
			kind: "expired_today",
			employeeSkill,
		});
		expect(notification).toMatchObject({
			userId: "anna",
			type: "skill_expired_today",
			title: "A skill expires today",
			message: 'Your skill "Forklift licence" expires today.',
			actionUrl: "/settings/profile#skills",
			idempotencyKey: "skill-expiry:es-1:expired_today:2026-11-30:anna",
		});
		expect(notification.metadata?.i18n).toMatchObject({
			titleKey: "common:notifications.content.skillExpiredToday.title",
			messageKey: "common:notifications.content.skillExpiredToday.employeeMessage",
			params: { skill: "Forklift licence", untilDate: "30 Nov 2026" },
		});
	});
});
