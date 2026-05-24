import { hasSettingsAccessTier } from "@/lib/settings-access";
import type { AppSearchResult, StaticAppSearchInput } from "./types";

export type StaticAppCommandInput = StaticAppSearchInput;

type StaticAppCommandDefinition = {
	id: string;
	titleKey: string;
	titleDefault: string;
	subtitleKey: string;
	subtitleDefault: string;
	keywords: { key: string; defaultValue: string }[];
	href: string;
	visibleFor: "employee" | "manager" | "orgAdmin";
	requiresProjectsEnabled?: boolean;
};

const STATIC_APP_COMMANDS: StaticAppCommandDefinition[] = [
	{
		id: "add-manual-time-entry",
		titleKey: "appSearch.commands.addManualTimeEntry.title",
		titleDefault: "Add manual time entry",
		subtitleKey: "appSearch.commands.addManualTimeEntry.subtitle",
		subtitleDefault: "Record hours for a past shift or correction",
		keywords: [
			{ key: "appSearch.commands.addManualTimeEntry.keywords.time", defaultValue: "time" },
			{ key: "appSearch.commands.addManualTimeEntry.keywords.hours", defaultValue: "hours" },
			{ key: "appSearch.commands.addManualTimeEntry.keywords.manual", defaultValue: "manual" },
			{ key: "appSearch.commands.addManualTimeEntry.keywords.entry", defaultValue: "entry" },
		],
		href: "/time-tracking",
		visibleFor: "employee",
	},
	{
		id: "request-absence",
		titleKey: "appSearch.commands.requestAbsence.title",
		titleDefault: "Request absence",
		subtitleKey: "appSearch.commands.requestAbsence.subtitle",
		subtitleDefault: "Start a vacation, sick leave, or time off request",
		keywords: [
			{ key: "appSearch.commands.requestAbsence.keywords.absence", defaultValue: "absence" },
			{ key: "appSearch.commands.requestAbsence.keywords.vacation", defaultValue: "vacation" },
			{ key: "appSearch.commands.requestAbsence.keywords.timeOff", defaultValue: "time off" },
		],
		href: "/absences",
		visibleFor: "employee",
	},
	{
		id: "submit-travel-expense",
		titleKey: "appSearch.commands.submitTravelExpense.title",
		titleDefault: "Submit travel expense",
		subtitleKey: "appSearch.commands.submitTravelExpense.subtitle",
		subtitleDefault: "Create a reimbursement request for travel costs",
		keywords: [
			{ key: "appSearch.commands.submitTravelExpense.keywords.travel", defaultValue: "travel" },
			{ key: "appSearch.commands.submitTravelExpense.keywords.expense", defaultValue: "expense" },
			{
				key: "appSearch.commands.submitTravelExpense.keywords.reimbursement",
				defaultValue: "reimbursement",
			},
		],
		href: "/travel-expenses",
		visibleFor: "employee",
	},
	{
		id: "open-my-requests",
		titleKey: "appSearch.commands.openMyRequests.title",
		titleDefault: "Open my requests",
		subtitleKey: "appSearch.commands.openMyRequests.subtitle",
		subtitleDefault: "Review your submitted absences and expenses",
		keywords: [
			{ key: "appSearch.commands.openMyRequests.keywords.requests", defaultValue: "requests" },
			{ key: "appSearch.commands.openMyRequests.keywords.mine", defaultValue: "mine" },
		],
		href: "/my-requests",
		visibleFor: "employee",
	},
	{
		id: "open-approvals-inbox",
		titleKey: "appSearch.commands.openApprovalsInbox.title",
		titleDefault: "Open approvals inbox",
		subtitleKey: "appSearch.commands.openApprovalsInbox.subtitle",
		subtitleDefault: "Review pending employee requests",
		keywords: [
			{
				key: "appSearch.commands.openApprovalsInbox.keywords.approvals",
				defaultValue: "approvals",
			},
			{ key: "appSearch.commands.openApprovalsInbox.keywords.inbox", defaultValue: "inbox" },
			{ key: "appSearch.commands.openApprovalsInbox.keywords.review", defaultValue: "review" },
		],
		href: "/approvals/inbox",
		visibleFor: "manager",
	},
	{
		id: "invite-teammate",
		titleKey: "appSearch.commands.inviteTeammate.title",
		titleDefault: "Invite teammate",
		subtitleKey: "appSearch.commands.inviteTeammate.subtitle",
		subtitleDefault: "Open organization management to add a colleague",
		keywords: [
			{ key: "appSearch.commands.inviteTeammate.keywords.invite", defaultValue: "invite" },
			{ key: "appSearch.commands.inviteTeammate.keywords.teammate", defaultValue: "teammate" },
			{ key: "appSearch.commands.inviteTeammate.keywords.member", defaultValue: "member" },
		],
		href: "/settings/organizations",
		visibleFor: "orgAdmin",
	},
	{
		id: "create-project",
		titleKey: "appSearch.commands.createProject.title",
		titleDefault: "Create project",
		subtitleKey: "appSearch.commands.createProject.subtitle",
		subtitleDefault: "Open project settings to define a new project",
		keywords: [
			{ key: "appSearch.commands.createProject.keywords.project", defaultValue: "project" },
			{ key: "appSearch.commands.createProject.keywords.create", defaultValue: "create" },
			{ key: "appSearch.commands.createProject.keywords.settings", defaultValue: "settings" },
		],
		href: "/settings/projects",
		visibleFor: "orgAdmin",
		requiresProjectsEnabled: true,
	},
	{
		id: "open-payroll-readiness",
		titleKey: "appSearch.commands.openPayrollReadiness.title",
		titleDefault: "Open payroll readiness",
		subtitleKey: "appSearch.commands.openPayrollReadiness.subtitle",
		subtitleDefault: "Check whether time data is ready for payroll",
		keywords: [
			{ key: "appSearch.commands.openPayrollReadiness.keywords.payroll", defaultValue: "payroll" },
			{
				key: "appSearch.commands.openPayrollReadiness.keywords.readiness",
				defaultValue: "readiness",
			},
			{ key: "appSearch.commands.openPayrollReadiness.keywords.export", defaultValue: "export" },
		],
		href: "/settings/payroll-readiness",
		visibleFor: "orgAdmin",
	},
	{
		id: "open-settings",
		titleKey: "appSearch.commands.openSettings.title",
		titleDefault: "Open settings",
		subtitleKey: "appSearch.commands.openSettings.subtitle",
		subtitleDefault: "Manage your profile, security, and organization settings",
		keywords: [
			{ key: "appSearch.commands.openSettings.keywords.settings", defaultValue: "settings" },
			{ key: "appSearch.commands.openSettings.keywords.preferences", defaultValue: "preferences" },
		],
		href: "/settings",
		visibleFor: "employee",
	},
];

function isManagerOrAdmin(employeeRole: StaticAppCommandInput["employeeRole"]): boolean {
	return employeeRole === "admin" || employeeRole === "manager";
}

function isVisibleCommand(
	command: StaticAppCommandDefinition,
	{ employeeRole, settingsAccessTier, featureFlags }: StaticAppCommandInput,
): boolean {
	if (command.requiresProjectsEnabled && !featureFlags?.projectsEnabled) {
		return false;
	}

	if (command.visibleFor === "orgAdmin") {
		return hasSettingsAccessTier(settingsAccessTier, "orgAdmin");
	}

	if (command.visibleFor === "manager") {
		return isManagerOrAdmin(employeeRole);
	}

	return true;
}

export function buildStaticAppCommands(input: StaticAppCommandInput): AppSearchResult[] {
	const { t } = input;

	return STATIC_APP_COMMANDS.filter((command) => isVisibleCommand(command, input)).map(
		(command) => ({
			type: "action",
			id: `action:${command.id}`,
			title: t(command.titleKey, command.titleDefault),
			subtitle: t(command.subtitleKey, command.subtitleDefault),
			keywords: command.keywords.map((keyword) => t(keyword.key, keyword.defaultValue)),
			href: command.href,
		}),
	);
}
