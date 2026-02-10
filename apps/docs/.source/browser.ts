// @ts-nocheck
import { browser } from "fumadocs-mdx/runtime/browser";
import type * as Config from "../source.config";

const create = browser<
	typeof Config,
	import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
		DocData: {};
	}
>();
const browserCollections = {
	docs: create.doc("docs", {
		"index.mdx": () => import("../content/docs/index.mdx?collection=docs"),
		"desktop/index.mdx": () =>
			import("../content/docs/desktop/index.mdx?collection=docs"),
		"guide/index.mdx": () =>
			import("../content/docs/guide/index.mdx?collection=docs"),
		"tech/index.mdx": () =>
			import("../content/docs/tech/index.mdx?collection=docs"),
		"desktop/features/idle-detection.mdx": () =>
			import(
				"../content/docs/desktop/features/idle-detection.mdx?collection=docs"
			),
		"desktop/features/index.mdx": () =>
			import("../content/docs/desktop/features/index.mdx?collection=docs"),
		"desktop/features/offline-mode.mdx": () =>
			import(
				"../content/docs/desktop/features/offline-mode.mdx?collection=docs"
			),
		"desktop/features/organizations.mdx": () =>
			import(
				"../content/docs/desktop/features/organizations.mdx?collection=docs"
			),
		"desktop/features/settings.mdx": () =>
			import("../content/docs/desktop/features/settings.mdx?collection=docs"),
		"desktop/features/system-tray.mdx": () =>
			import(
				"../content/docs/desktop/features/system-tray.mdx?collection=docs"
			),
		"desktop/features/time-tracking.mdx": () =>
			import(
				"../content/docs/desktop/features/time-tracking.mdx?collection=docs"
			),
		"desktop/getting-started/authentication.mdx": () =>
			import(
				"../content/docs/desktop/getting-started/authentication.mdx?collection=docs"
			),
		"desktop/getting-started/first-steps.mdx": () =>
			import(
				"../content/docs/desktop/getting-started/first-steps.mdx?collection=docs"
			),
		"desktop/getting-started/index.mdx": () =>
			import(
				"../content/docs/desktop/getting-started/index.mdx?collection=docs"
			),
		"desktop/getting-started/installation.mdx": () =>
			import(
				"../content/docs/desktop/getting-started/installation.mdx?collection=docs"
			),
		"desktop/troubleshooting/common-issues.mdx": () =>
			import(
				"../content/docs/desktop/troubleshooting/common-issues.mdx?collection=docs"
			),
		"desktop/troubleshooting/index.mdx": () =>
			import(
				"../content/docs/desktop/troubleshooting/index.mdx?collection=docs"
			),
		"desktop/troubleshooting/platform-specific.mdx": () =>
			import(
				"../content/docs/desktop/troubleshooting/platform-specific.mdx?collection=docs"
			),
		"guide/getting-started/index.mdx": () =>
			import("../content/docs/guide/getting-started/index.mdx?collection=docs"),
		"guide/admin-guide/analytics-and-exports.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/analytics-and-exports.mdx?collection=docs"
			),
		"guide/admin-guide/api-keys.mdx": () =>
			import("../content/docs/guide/admin-guide/api-keys.mdx?collection=docs"),
		"guide/admin-guide/app-access-control.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/app-access-control.mdx?collection=docs"
			),
		"guide/admin-guide/billing.mdx": () =>
			import("../content/docs/guide/admin-guide/billing.mdx?collection=docs"),
		"guide/admin-guide/change-policies.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/change-policies.mdx?collection=docs"
			),
		"guide/admin-guide/compliance-radar.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/compliance-radar.mdx?collection=docs"
			),
		"guide/admin-guide/conditional-access.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/conditional-access.mdx?collection=docs"
			),
		"guide/admin-guide/discord-integration.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/discord-integration.mdx?collection=docs"
			),
		"guide/admin-guide/employee-management.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/employee-management.mdx?collection=docs"
			),
		"guide/admin-guide/holidays-and-vacation.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/holidays-and-vacation.mdx?collection=docs"
			),
		"guide/admin-guide/index.mdx": () =>
			import("../content/docs/guide/admin-guide/index.mdx?collection=docs"),
		"guide/admin-guide/locations.mdx": () =>
			import("../content/docs/guide/admin-guide/locations.mdx?collection=docs"),
		"guide/admin-guide/manager-assignments.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/manager-assignments.mdx?collection=docs"
			),
		"guide/admin-guide/payroll-export.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/payroll-export.mdx?collection=docs"
			),
		"guide/admin-guide/permissions.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/permissions.mdx?collection=docs"
			),
		"guide/admin-guide/platform-admin.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/platform-admin.mdx?collection=docs"
			),
		"guide/admin-guide/project-reports.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/project-reports.mdx?collection=docs"
			),
		"guide/admin-guide/projects.mdx": () =>
			import("../content/docs/guide/admin-guide/projects.mdx?collection=docs"),
		"guide/admin-guide/schedules.mdx": () =>
			import("../content/docs/guide/admin-guide/schedules.mdx?collection=docs"),
		"guide/admin-guide/scim-provisioning.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/scim-provisioning.mdx?collection=docs"
			),
		"guide/admin-guide/skills-qualifications.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/skills-qualifications.mdx?collection=docs"
			),
		"guide/admin-guide/slack-integration.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/slack-integration.mdx?collection=docs"
			),
		"guide/admin-guide/social-oauth.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/social-oauth.mdx?collection=docs"
			),
		"guide/admin-guide/surcharges.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/surcharges.mdx?collection=docs"
			),
		"guide/admin-guide/system-administration.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/system-administration.mdx?collection=docs"
			),
		"guide/admin-guide/teams-integration.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/teams-integration.mdx?collection=docs"
			),
		"guide/admin-guide/teams.mdx": () =>
			import("../content/docs/guide/admin-guide/teams.mdx?collection=docs"),
		"guide/admin-guide/telegram-integration.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/telegram-integration.mdx?collection=docs"
			),
		"guide/admin-guide/telemetry.mdx": () =>
			import("../content/docs/guide/admin-guide/telemetry.mdx?collection=docs"),
		"guide/admin-guide/time-regulations.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/time-regulations.mdx?collection=docs"
			),
		"guide/admin-guide/troubleshooting.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/troubleshooting.mdx?collection=docs"
			),
		"guide/admin-guide/webhooks.mdx": () =>
			import("../content/docs/guide/admin-guide/webhooks.mdx?collection=docs"),
		"guide/admin-guide/work-categories.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/work-categories.mdx?collection=docs"
			),
		"guide/admin-guide/work-policies.mdx": () =>
			import(
				"../content/docs/guide/admin-guide/work-policies.mdx?collection=docs"
			),
		"guide/manager-guide/coverage-targets.mdx": () =>
			import(
				"../content/docs/guide/manager-guide/coverage-targets.mdx?collection=docs"
			),
		"guide/manager-guide/index.mdx": () =>
			import("../content/docs/guide/manager-guide/index.mdx?collection=docs"),
		"guide/user-guide/account-security.mdx": () =>
			import(
				"../content/docs/guide/user-guide/account-security.mdx?collection=docs"
			),
		"guide/user-guide/browser-extension.mdx": () =>
			import(
				"../content/docs/guide/user-guide/browser-extension.mdx?collection=docs"
			),
		"guide/user-guide/calendar-sync.mdx": () =>
			import(
				"../content/docs/guide/user-guide/calendar-sync.mdx?collection=docs"
			),
		"guide/user-guide/calendar.mdx": () =>
			import("../content/docs/guide/user-guide/calendar.mdx?collection=docs"),
		"guide/user-guide/desktop-app.mdx": () =>
			import(
				"../content/docs/guide/user-guide/desktop-app.mdx?collection=docs"
			),
		"guide/user-guide/faq.mdx": () =>
			import("../content/docs/guide/user-guide/faq.mdx?collection=docs"),
		"guide/user-guide/getting-started.mdx": () =>
			import(
				"../content/docs/guide/user-guide/getting-started.mdx?collection=docs"
			),
		"guide/user-guide/index.mdx": () =>
			import("../content/docs/guide/user-guide/index.mdx?collection=docs"),
		"guide/user-guide/language-preferences.mdx": () =>
			import(
				"../content/docs/guide/user-guide/language-preferences.mdx?collection=docs"
			),
		"guide/user-guide/notifications.mdx": () =>
			import(
				"../content/docs/guide/user-guide/notifications.mdx?collection=docs"
			),
		"guide/user-guide/time-tracking.mdx": () =>
			import(
				"../content/docs/guide/user-guide/time-tracking.mdx?collection=docs"
			),
		"guide/user-guide/vacation.mdx": () =>
			import("../content/docs/guide/user-guide/vacation.mdx?collection=docs"),
		"guide/user-guide/wellness.mdx": () =>
			import("../content/docs/guide/user-guide/wellness.mdx?collection=docs"),
		"tech/deployment/index.mdx": () =>
			import("../content/docs/tech/deployment/index.mdx?collection=docs"),
		"tech/technical/authentication.mdx": () =>
			import(
				"../content/docs/tech/technical/authentication.mdx?collection=docs"
			),
		"tech/technical/database.mdx": () =>
			import("../content/docs/tech/technical/database.mdx?collection=docs"),
		"tech/technical/enterprise.mdx": () =>
			import("../content/docs/tech/technical/enterprise.mdx?collection=docs"),
		"tech/technical/features.mdx": () =>
			import("../content/docs/tech/technical/features.mdx?collection=docs"),
		"tech/technical/getting-started.mdx": () =>
			import(
				"../content/docs/tech/technical/getting-started.mdx?collection=docs"
			),
		"tech/technical/index.mdx": () =>
			import("../content/docs/tech/technical/index.mdx?collection=docs"),
		"tech/technical/services.mdx": () =>
			import("../content/docs/tech/technical/services.mdx?collection=docs"),
		"tech/technical/testing.mdx": () =>
			import("../content/docs/tech/technical/testing.mdx?collection=docs"),
	}),
};
export default browserCollections;
