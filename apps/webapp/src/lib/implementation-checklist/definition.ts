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
	titleKey: string;
	description: string;
	descriptionKey: string;
	helperText: string;
	helperTextKey: string;
	actionLabel: string;
	actionLabelKey: string;
	href: string;
	detector: ImplementationChecklistDetector;
	canManualComplete: boolean;
}

export const IMPLEMENTATION_CHECKLIST_ITEMS: ImplementationChecklistDefinition[] = [
	{
		id: "organization-structure",
		title: "Organization structure",
		titleKey: "settings.implementationChecklist.items.organizationStructure.title",
		description: "Confirm members, teams, and responsibility boundaries before rollout.",
		descriptionKey: "settings.implementationChecklist.items.organizationStructure.description",
		helperText: "Manual review: Z8 cannot know whether your rollout structure is final.",
		helperTextKey: "settings.implementationChecklist.items.organizationStructure.helperText",
		actionLabel: "Review organization",
		actionLabelKey: "settings.implementationChecklist.items.organizationStructure.actionLabel",
		href: "/settings/organizations",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "holidays",
		title: "Holidays",
		titleKey: "settings.implementationChecklist.items.holidays.title",
		description:
			"Configure public holidays and closing days used by absence and payroll workflows.",
		descriptionKey: "settings.implementationChecklist.items.holidays.description",
		helperText: "Z8 checks for active holiday presets, assignments, or custom holidays.",
		helperTextKey: "settings.implementationChecklist.items.holidays.helperText",
		actionLabel: "Configure holidays",
		actionLabelKey: "settings.implementationChecklist.items.holidays.actionLabel",
		href: "/settings/holidays",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "work-policies",
		title: "Work policies",
		titleKey: "settings.implementationChecklist.items.workPolicies.title",
		description: "Set schedules, working time rules, and policy assignments for the organization.",
		descriptionKey: "settings.implementationChecklist.items.workPolicies.description",
		helperText: "Z8 checks for active work policies or active work policy assignments.",
		helperTextKey: "settings.implementationChecklist.items.workPolicies.helperText",
		actionLabel: "Configure work policies",
		actionLabelKey: "settings.implementationChecklist.items.workPolicies.actionLabel",
		href: "/settings/work-policies",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "approval-rules",
		title: "Approval rules",
		titleKey: "settings.implementationChecklist.items.approvalRules.title",
		description: "Review who approves corrections, absences, and policy-sensitive changes.",
		descriptionKey: "settings.implementationChecklist.items.approvalRules.description",
		helperText: "Manual review: approval readiness depends on your internal process.",
		helperTextKey: "settings.implementationChecklist.items.approvalRules.helperText",
		actionLabel: "Review approval rules",
		actionLabelKey: "settings.implementationChecklist.items.approvalRules.actionLabel",
		href: "/settings/change-policies",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "payroll-readiness",
		title: "Payroll export",
		titleKey: "settings.implementationChecklist.items.payrollReadiness.title",
		description: "Confirm payroll readiness checks and export operations before the first pay run.",
		descriptionKey: "settings.implementationChecklist.items.payrollReadiness.description",
		helperText:
			"Manual review: export readiness should be confirmed by an admin before payroll cutoff.",
		helperTextKey: "settings.implementationChecklist.items.payrollReadiness.helperText",
		actionLabel: "Review payroll readiness",
		actionLabelKey: "settings.implementationChecklist.items.payrollReadiness.actionLabel",
		href: "/settings/payroll-readiness",
		detector: "manual",
		canManualComplete: true,
	},
	{
		id: "integrations",
		title: "Integrations",
		titleKey: "settings.implementationChecklist.items.integrations.title",
		description: "Connect the notification, bot, webhook, or export integrations your team needs.",
		descriptionKey: "settings.implementationChecklist.items.integrations.description",
		helperText: "Z8 checks for active Slack, Discord, Teams, Telegram, or webhook configuration.",
		helperTextKey: "settings.implementationChecklist.items.integrations.helperText",
		actionLabel: "Review integrations",
		actionLabelKey: "settings.implementationChecklist.items.integrations.actionLabel",
		href: "/settings/webhooks",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "notifications",
		title: "Notifications",
		titleKey: "settings.implementationChecklist.items.notifications.title",
		description: "Make sure admins and employees receive the right approval and status updates.",
		descriptionKey: "settings.implementationChecklist.items.notifications.description",
		helperText: "Z8 checks for notification preferences or configured notification channels.",
		helperTextKey: "settings.implementationChecklist.items.notifications.helperText",
		actionLabel: "Configure notifications",
		actionLabelKey: "settings.implementationChecklist.items.notifications.actionLabel",
		href: "/settings/notifications",
		detector: "automatic",
		canManualComplete: false,
	},
	{
		id: "employee-import",
		title: "First employee import",
		titleKey: "settings.implementationChecklist.items.employeeImport.title",
		description:
			"Add the first employees so schedules, approvals, and payroll exports have real users.",
		descriptionKey: "settings.implementationChecklist.items.employeeImport.description",
		helperText: "Z8 checks whether the organization has more than the founding/admin employee.",
		helperTextKey: "settings.implementationChecklist.items.employeeImport.helperText",
		actionLabel: "Import employees",
		actionLabelKey: "settings.implementationChecklist.items.employeeImport.actionLabel",
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
