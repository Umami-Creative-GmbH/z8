export type ImplementationChecklistItemId =
	| "organization-structure"
	| "holidays"
	| "work-policies"
	| "approval-rules"
	| "payroll-readiness"
	| "integrations"
	| "notifications"
	| "employee-import";

export type ImplementationChecklistDetector = "automatic" | "manual";

export interface ImplementationChecklistDefinition {
	id: ImplementationChecklistItemId;
	title: string;
	description: string;
	helperText: string;
	actionLabel: string;
	href: string;
	detector: ImplementationChecklistDetector;
	canManualComplete: boolean;
}

export const IMPLEMENTATION_CHECKLIST_ITEMS: ImplementationChecklistDefinition[] = [
	{
		id: "organization-structure",
		title: "Organization structure",
		description: "Confirm members, teams, and responsibility boundaries before rollout.",
		helperText: "Manual review: Z8 cannot know whether your rollout structure is final.",
		actionLabel: "Review organization",
		href: "/settings/organizations",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "holidays",
		title: "Holidays",
		description: "Configure public holidays and closing days used by absence and payroll workflows.",
		helperText: "Z8 checks for active holiday presets, assignments, or custom holidays.",
		actionLabel: "Configure holidays",
		href: "/settings/holidays",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "work-policies",
		title: "Work policies",
		description: "Set schedules, working time rules, and policy assignments for the organization.",
		helperText: "Z8 checks for active work policies or active work policy assignments.",
		actionLabel: "Configure work policies",
		href: "/settings/work-policies",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "approval-rules",
		title: "Approval rules",
		description: "Review who approves corrections, absences, and policy-sensitive changes.",
		helperText: "Manual review: approval readiness depends on your internal process.",
		actionLabel: "Review approval rules",
		href: "/settings/change-policies",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "payroll-readiness",
		title: "Payroll export",
		description: "Confirm payroll readiness checks and export operations before the first pay run.",
		helperText: "Manual review: export readiness should be confirmed by an admin before payroll cutoff.",
		actionLabel: "Review payroll readiness",
		href: "/settings/payroll-readiness",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "integrations",
		title: "Integrations",
		description: "Connect the notification, bot, webhook, or export integrations your team needs.",
		helperText: "Z8 checks for active Slack, Discord, Teams, Telegram, or webhook configuration.",
		actionLabel: "Review integrations",
		href: "/settings/webhooks",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "notifications",
		title: "Notifications",
		description: "Make sure admins and employees receive the right approval and status updates.",
		helperText: "Z8 checks for notification preferences or configured notification channels.",
		actionLabel: "Configure notifications",
		href: "/settings/notifications",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "employee-import",
		title: "First employee import",
		description: "Add the first employees so schedules, approvals, and payroll exports have real users.",
		helperText: "Z8 checks whether the organization has more than the founding/admin employee.",
		actionLabel: "Import employees",
		href: "/settings/import",
		detector: "automatic",
		canManualComplete: false,
	},
];

export const IMPLEMENTATION_CHECKLIST_ITEM_IDS = IMPLEMENTATION_CHECKLIST_ITEMS.map(
	(item) => item.id,
);

export function isImplementationChecklistItemId(
	value: string,
): value is ImplementationChecklistItemId {
	return IMPLEMENTATION_CHECKLIST_ITEM_IDS.includes(value as ImplementationChecklistItemId);
}
