import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const checks: Array<{ file: string; patterns: RegExp[] }> = [
	{
		file: "src/app/[locale]/(app)/analytics/page.tsx",
		patterns: [/"Failed to load analytics data"/, />Total Employees</, />Work Hours by Team</],
	},
	{
		file: "src/app/[locale]/(app)/today/today-briefing.tsx",
		patterns: [/>Manager Daily Briefing</, />Critical issues</, /aria-label="Today summary"/],
	},
	{
		file: "src/components/organization/create-team-dialog.tsx",
		patterns: [/>Create Team</, /"Failed to create team"/, /placeholder="Team name"/],
	},
	{
		file: "src/components/organization/organization-tab.tsx",
		patterns: [/>Create New Organization</, />Members & Invitations</, />Invite Member</],
	},
	{
		file: "src/components/organization/organization-details-card.tsx",
		patterns: [/aria-label="Upload organization logo"/, />Edit</, /\? "member" : "members"/],
	},
	{
		file: "src/components/organization/team-card.tsx",
		patterns: [/>Manage Members</, />Fallback manager</, /: "Not assigned"/],
	},
	{
		file: "src/components/notifications/notification-settings.tsx",
		patterns: [
			/>Notification Preferences</,
			/>Enable Push Notifications</,
			/"Unable to load notification preferences"/,
		],
	},
	{
		file: "src/components/licenses/license-table.tsx",
		patterns: [/placeholder="IconSearch packages or licenses…"/, />No packages found\.</],
	},
	{
		file: "src/components/theme-toggle.tsx",
		patterns: [/>Toggle theme</, />Light</, />Dark</],
	},
	{
		file: "src/components/user-avatar.tsx",
		patterns: [/label: "Clocked in"/, /name \|\| "User avatar"/],
	},
	{
		file: "src/components/data-table-server/data-table.tsx",
		patterns: [/aria-label="Select all"/, /aria-label="Select row"/],
	},
	{
		file: "src/app/[locale]/(app)/settings/permissions/permissions-page-client.tsx",
		patterns: [/\|\| "Failed to load employees"/],
	},
	{
		file: "src/components/settings/enterprise/domain-management.tsx",
		patterns: [
			/>Custom Domain</,
			/>No custom domain configured yet\.</,
			/"Failed to delete domain"/,
		],
	},
	{
		file: "src/components/settings/audit-log-viewer.tsx",
		patterns: [/>Audit Log Entries</, />IP Address</, /"Failed to export audit logs"/],
	},
	{
		file: "src/components/scheduling/scheduler/shift-scheduler.tsx",
		patterns: [/>Loading schedule\.\.\.</],
	},
	{
		file: "src/lib/authorization/permission-registry.ts",
		patterns: [
			/label: "Manage Employees"/,
			/description: "Full access to employee profiles and settings"/,
		],
	},
	{
		file: "src/components/settings/import/import-review-page.tsx",
		patterns: [
			/>Import Review</,
			/toast\.error\([^\n]*"Failed to start import commit"/,
			/\? "Committing/,
		],
	},
	{
		file: "src/components/settings/import/import-review-table.tsx",
		patterns: [/>Rows</, />No staged rows are available/, />Source ID</],
	},
	{
		file: "src/components/settings/import/import-issue-groups.tsx",
		patterns: [/>Issue groups</, /title: "Duplicates"/, />\s*Current rows include/],
	},
	{
		file: "src/app/[locale]/onboarding/organization/page.tsx",
		patterns: [
			/\.min\(2, "Slug must be at least 2 characters"/,
			/message: "Slug cannot start or end with a hyphen"/,
		],
	},
	{
		file: "src/lib/notifications/triggers.ts",
		patterns: [
			/title: "Absence request submitted"/,
			/title: "Password changed"/,
			/title: "Shift assigned"/,
		],
	},
	{
		file: "src/lib/teams/cards/approval-card.ts",
		patterns: [
			/const title = isAbsence \? "Absence Request"/,
			/title: "Approve"/,
			/title: "View in Z8"/,
		],
	},
	{
		file: "src/lib/teams/cards/compliance-card.ts",
		patterns: [
			/text: "[^"\n]*Compliance Summary"/,
			/text: "Violations"/,
			/title: "View Compliance Dashboard"/,
		],
	},
	{
		file: "src/lib/teams/cards/coverage-card.ts",
		patterns: [/text: "[^"\n]*Coverage Report"/, /text: "Scheduled"/, /text: "Variance"/],
	},
	{
		file: "src/lib/teams/cards/daily-digest-card.ts",
		patterns: [
			/lines\.push\("\*\*Pending Approvals:\*\* None"/,
			/lines\.push\("Everyone is available"/,
			/lines\.push\("No one yet"/,
		],
	},
	{
		file: "src/lib/manager-daily-briefing/get-manager-daily-briefing.ts",
		patterns: [
			/title: "Approvals"/,
			/description: "Pending requests waiting for a decision\."/,
			/return "Section could not be loaded\."/,
		],
	},
	{
		file: "src/lib/manager-daily-briefing/logic.ts",
		patterns: [
			/title: `[^`]*has not clocked in`/,
			/title: `[^`]*clocked in late`/,
			/title: `[^`]*is understaffed`/,
		],
	},
];

describe("webapp i18n hardcoded sweep", () => {
	it.each(checks)("does not leave known raw UI copy in $file", ({ file, patterns }) => {
		const source = readFileSync(file, "utf8");

		for (const pattern of patterns) {
			expect(source, `${file} should not contain ${pattern}`).not.toMatch(pattern);
		}
	});
});
