import type { ImplementationChecklistItemRole } from "./go-live/types";

export type ImplementationChecklistItemId =
	| "organization-structure"
	| "holidays"
	| "work-policies"
	| "approval-rules"
	| "payroll-readiness"
	| "integrations"
	| "notifications"
	| "employee-import"
	| "first-workflows";

/**
 * How an item is completed: a presence detector, a manual confirmation, a go-live check
 * registered in go-live/checks for the item, or first-workflow evidence noticed from real use.
 */
export type ImplementationChecklistDetector = "automatic" | "manual" | "go-live" | "evidence";

/**
 * The configuration a manual confirmation vouches for. Confirming stores its
 * fingerprint, and the confirmation goes stale when the fingerprint changes (#1516):
 * - `organization-structure`: teams, team memberships, primary teams, manager links,
 *   member roles and custom role assignments;
 * - `approval-rules`: change policies and their assignments, approval routing
 *   policies with stages, conditions and the employee groups they name, and which
 *   absence categories require approval;
 * - `payroll-export`: payroll export configs, wage-type and expense wage-type mappings.
 */
export type ImplementationChecklistCoveredConfiguration =
	| "organization-structure"
	| "approval-rules"
	| "payroll-export";

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
	/** What a manual confirmation of the item covers; null when it can't be confirmed. */
	confirmationCovers: ImplementationChecklistCoveredConfiguration | null;
	href: string;
	detector: ImplementationChecklistDetector;
	canManualComplete: boolean;
	/** How the item counts for go-live readiness and checklist progress. */
	role: ImplementationChecklistItemRole;
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
		confirmationCovers: "organization-structure",
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
		confirmationCovers: null,
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
		confirmationCovers: null,
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
		helperText: "Manual review: approval readiness depends on your internal process.",
		helperTextKey: "settings.implementationChecklist.items.approvalRules.helperText",
		actionLabel: "Review approval rules",
		actionLabelKey: "settings.implementationChecklist.items.approvalRules.actionLabel",
		confirmationCovers: "approval-rules",
		href: "/settings/change-policies",
		detector: "manual",
		canManualComplete: true,
		role: "manual-only",
	},
	{
		id: "payroll-readiness",
		title: "Payroll export",
		titleKey: "settings.implementationChecklist.items.payrollReadiness.title",
		description: "Confirm payroll readiness checks and export operations before the first pay run.",
		descriptionKey: "settings.implementationChecklist.items.payrollReadiness.description",
		helperText:
			"Z8 checks the payroll setup for everyone on the current roster: export target, wage-type mappings, confirmed employment terms and personnel identifiers. Without an active payroll export target, payroll export is an optional integration.",
		helperTextKey: "settings.implementationChecklist.items.payrollReadiness.goLiveHelperText",
		actionLabel: "Review payroll readiness",
		actionLabelKey: "settings.implementationChecklist.items.payrollReadiness.actionLabel",
		confirmationCovers: "payroll-export",
		href: "/settings/payroll-readiness",
		detector: "go-live",
		// An optional business confirmation; it never verifies the item.
		canManualComplete: true,
		// Advisory for a run without an active payroll export target (the check's outcome says so).
		role: "mandatory",
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
		confirmationCovers: null,
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
		confirmationCovers: null,
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
		confirmationCovers: null,
		href: "/settings/import",
		detector: "automatic",
		canManualComplete: false,
		role: "informational",
	},
	{
		id: "first-workflows",
		title: "First workflows",
		titleKey: "settings.implementationChecklist.items.firstWorkflows.title",
		description: "See that your organization has really started working with Z8.",
		descriptionKey: "settings.implementationChecklist.items.firstWorkflows.description",
		helperText:
			"Z8 notices the first clock-in, the first decided request and the first successful payroll export from real activity. This never affects go-live readiness.",
		helperTextKey: "settings.implementationChecklist.items.firstWorkflows.helperText",
		actionLabel: "Open time tracking",
		actionLabelKey: "settings.implementationChecklist.items.firstWorkflows.actionLabel",
		confirmationCovers: null,
		href: "/time-tracking",
		detector: "evidence",
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
