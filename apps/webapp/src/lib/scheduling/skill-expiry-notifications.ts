import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import type { ExpiryReminderKind } from "@/lib/expiry-reminders/expiry";
import type { CreateNotificationParams, NotificationType } from "@/lib/notifications/types";

/**
 * Skill expiry reminder notifications (#1143): "expires soon" within the
 * organization's skill reminder lead time, "expires today" on the skill expiry
 * date (the last valid day). Managers (or owners and admins when the employee
 * has none) are told whose skill it is and get a link to the employee's
 * skills; the employee gets a link to the skills on their own profile.
 */

export type SkillExpiryReminderAudience = "employee" | "manager";

/** The employee's own skills on their profile (`OwnSkillsCard`). */
export const OWN_SKILLS_PATH = "/settings/profile#skills";
const EMPLOYEE_SETTINGS_PATH = "/settings/employees";
/** Server-rendered default; readers see `untilDay` in their own locale. */
const NOTIFICATION_DATE_LOCALE = "en-GB";

const copy = {
	upcoming: {
		manager: {
			titleKey: "common:notifications.content.skillExpiryUpcoming.title",
			titleDefault: "A skill expires soon",
			messageKey: "common:notifications.content.skillExpiryUpcoming.message",
			messageDefault: 'The skill "{skill}" of {employee} expires on {untilDate}.',
		},
		employee: {
			titleKey: "common:notifications.content.skillExpiryUpcoming.title",
			titleDefault: "A skill expires soon",
			messageKey: "common:notifications.content.skillExpiryUpcoming.employeeMessage",
			messageDefault: 'Your skill "{skill}" expires on {untilDate}.',
		},
	},
	expired_today: {
		manager: {
			titleKey: "common:notifications.content.skillExpiredToday.title",
			titleDefault: "A skill expires today",
			messageKey: "common:notifications.content.skillExpiredToday.message",
			messageDefault: 'The skill "{skill}" of {employee} expires today.',
		},
		employee: {
			titleKey: "common:notifications.content.skillExpiredToday.title",
			titleDefault: "A skill expires today",
			messageKey: "common:notifications.content.skillExpiredToday.employeeMessage",
			messageDefault: 'Your skill "{skill}" expires today.',
		},
	},
} as const satisfies Record<
	ExpiryReminderKind,
	Record<
		SkillExpiryReminderAudience,
		{ titleKey: string; titleDefault: string; messageKey: string; messageDefault: string }
	>
>;

const TYPES: Record<ExpiryReminderKind, NotificationType> = {
	upcoming: "skill_expiry_upcoming",
	expired_today: "skill_expired_today",
};

export interface ExpiringEmployeeSkillRef {
	/** The employee skill id. */
	id: string;
	employeeId: string;
	employeeName: string;
	skillName: string;
	/** Skill expiry date, `YYYY-MM-DD`. */
	expiryDate: string;
}

function fill(template: string, params: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
}

export function buildSkillExpiryReminderNotification(input: {
	organizationId: string;
	recipientUserId: string;
	audience: SkillExpiryReminderAudience;
	kind: ExpiryReminderKind;
	employeeSkill: ExpiringEmployeeSkillRef;
}): CreateNotificationParams {
	const { employeeSkill } = input;
	const text = copy[input.kind][input.audience];
	const untilDate = formatPlainDate(
		parsePlainDate(employeeSkill.expiryDate),
		NOTIFICATION_DATE_LOCALE,
		"dateMedium",
	);
	const params: Record<string, string> =
		input.audience === "manager"
			? { skill: employeeSkill.skillName, employee: employeeSkill.employeeName, untilDate }
			: { skill: employeeSkill.skillName, untilDate };
	return {
		userId: input.recipientUserId,
		organizationId: input.organizationId,
		type: TYPES[input.kind],
		title: text.titleDefault,
		message: fill(text.messageDefault, params),
		entityType: "employee_skill",
		entityId: employeeSkill.id,
		actionUrl:
			input.audience === "manager"
				? `${EMPLOYEE_SETTINGS_PATH}/${employeeSkill.employeeId}`
				: OWN_SKILLS_PATH,
		idempotencyKey: `skill-expiry:${employeeSkill.id}:${input.kind}:${employeeSkill.expiryDate}:${input.recipientUserId}`,
		metadata: {
			employeeId: employeeSkill.employeeId,
			expiryDate: employeeSkill.expiryDate,
			untilDay: employeeSkill.expiryDate,
			i18n: { ...text, params },
		},
	};
}
