import type { ImplementationChecklistItemRole } from "./go-live/types";

export type ImplementationChecklistItemId =
	| "organization-structure"
	| "holidays"
	| "work-policies"
	| "approval-rules"
	| "payroll-readiness"
	| "integrations"
	| "notifications"
	| "employee-import";

/**
 * How an item is completed: a presence detector, a manual confirmation, or a go-live check
 * registered in go-live/checks for the item.
 */
export type ImplementationChecklistDetector = "automatic" | "manual" | "go-live";

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
	/** How the item counts for go-live readiness and checklist progress. */
	role: ImplementationChecklistItemRole;
	/**
	 * The optional business confirmation of a go-live item ("our approval process is agreed"):
	 * the action that records it and the text shown once recorded. It never verifies the item.
	 */
	confirmationLabel?: string;
	confirmationLabelKey?: string;
	confirmedLabel?: string;
	confirmedLabelKey?: string;
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
		role: "manual-only",
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
		role: "informational",
	},
	{
		id: "work-policies",
		title: "Work policies",
		titleKey: "settings.implementationChecklist.items.workPolicies.title",
		description: "Set schedules, working time rules, and policy assignments for the organization.",
		descriptionKey: "settings.implementationChecklist.items.workPolicies.description",
		helperText:
			"Z8 checks that every employee on the current roster has an effective work policy today.",
		helperTextKey: "settings.implementationChecklist.items.workPolicies.goLiveHelperText",
		actionLabel: "Configure work policies",
		actionLabelKey: "settings.implementationChecklist.items.workPolicies.actionLabel",
		href: "/settings/work-policies",
		detector: "go-live",
		canManualComplete: false,
		role: "mandatory",
	},
	{
		id: "approval-rules",
		title: "Approval rules",
		titleKey: "settings.implementationChecklist.items.approvalRules.title",
		description: "Review who approves corrections, absences, and policy-sensitive changes.",
		descriptionKey: "settings.implementationChecklist.items.approvalRules.description",
		helperText:
			"Z8 checks that every employee on the current roster can get each kind of request decided. Confirming that your approval process is agreed is optional.",
		helperTextKey: "settings.implementationChecklist.items.approvalRules.goLiveHelperText",
		actionLabel: "Review approval rules",
		actionLabelKey: "settings.implementationChecklist.items.approvalRules.actionLabel",
		href: "/settings/change-policies",
		detector: "go-live",
		canManualComplete: true,
		role: "mandatory",
		confirmationLabel: "Confirm our approval process is agreed",
		confirmationLabelKey: "settings.implementationChecklist.items.approvalRules.confirmationLabel",
		confirmedLabel: "Confirmed: our approval process is agreed",
		confirmedLabelKey: "settings.implementationChecklist.items.approvalRules.confirmedLabel",
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
		role: "manual-only",
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
		role: "informational",
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
		role: "informational",
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
		role: "informational",
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
