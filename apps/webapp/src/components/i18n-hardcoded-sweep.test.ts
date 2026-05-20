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
		patterns: [/placeholder="IconSearch packages or licenses\.\.\."/, />No packages found\.</],
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
];

describe("webapp i18n hardcoded sweep", () => {
	it.each(checks)("does not leave known raw UI copy in $file", ({ file, patterns }) => {
		const source = readFileSync(file, "utf8");

		for (const pattern of patterns) {
			expect(source, `${file} should not contain ${pattern}`).not.toMatch(pattern);
		}
	});
});
