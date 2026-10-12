import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	APP_ROUTE_METADATA,
	UNKNOWN_ROUTE_METADATA,
} from "@/lib/navigation/route-metadata";
import {
	loadCatalogSlice,
	loadCompleteServerTranslations,
	loadShellTranslations,
} from "./load-translations";
import { ALL_LANGUAGES, ALL_NAMESPACES } from "./shared";
import { SHELL_CATALOG_KEYS } from "./shell-catalog";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

// Explicit shell reachability inventory, including dialogs, toasts and dynamic label registries.
const SHELL_SOURCES = [
	"components/app-sidebar.tsx",
	"components/app-search.tsx",
	"components/nav-main.tsx",
	"components/nav-secondary.tsx",
	"components/nav-team.tsx",
	"components/nav-user.tsx",
	"components/nav-user-preferences.tsx",
	"components/user-avatar.tsx",
	"components/font-size-preference-utils.ts",
	"components/site-header.tsx",
	"components/header-timezone-control.tsx",
	"components/settings/timezone-picker.tsx",
	"components/organization-switcher.tsx",
	"components/organization/create-organization-dialog.tsx",
	"components/organization/organization-deletion-banner.tsx",
	"components/billing/trial-banner.tsx",
	"components/store-app/get-the-app-banner.tsx",
	"components/offline/sw-update-prompt.tsx",
	"components/offline/offline-banner.tsx",
	"components/offline/offline-recovery-dialog.tsx",
	"components/offline/offline-capture-actions.tsx",
	"components/deployment-refresh/deployment-refresh-checker.tsx",
	"components/notifications/notification-bell.tsx",
	"components/notifications/notification-popover.tsx",
	"components/notifications/notification-list.tsx",
	"components/notifications/notification-item.tsx",
	"components/notifications/push-permission-provider.tsx",
	"components/notifications/push-permission-modal.tsx",
	"lib/notifications/localized-notification.ts",
	"components/time-tracking/time-clock-popover.tsx",
	"components/time-tracking/quick-break-popover.tsx",
	"components/time-tracking/use-quick-break-handler.ts",
	"components/time-tracking/project-selector.tsx",
	"components/time-tracking/work-category-selector.tsx",
	"components/time-tracking/clock-in-out-widget-parts.tsx",
	"components/time-tracking/billable-work-switch.tsx",
	"components/time-tracking/clock-connection-notice.tsx",
	"components/time-tracking/saved-clock-toast.ts",
	"components/time-tracking/append-review-toast.ts",
	"components/time-tracking/timezone-mismatch-dialog.tsx",
	"components/position-capture/position-consent-dialog.tsx",
	"components/position-capture/position-notice-text.tsx",
	"components/dashboard/dashboard-header-customize.tsx",
	"components/dashboard/dashboard-customize-menu.tsx",
	"components/dashboard/widget-registry.ts",
	"components/settings/settings-config.ts",
	"lib/app-search/static-results.ts",
	"lib/app-search/static-commands.ts",
	"lib/navigation/route-metadata.ts",
];
function getPath(value: unknown, path: readonly string[]): unknown {
	return path.reduce<unknown>(
		(node, key) =>
			typeof node === "object" && node !== null
				? (node as Record<string, unknown>)[key]
				: undefined,
		value,
	);
}
const consumerKeys = new Set(
	SHELL_SOURCES.flatMap((file) =>
		[
			...readFileSync(join(process.cwd(), "src", file), "utf8").matchAll(
				/"([a-zA-Z][\w:-]*(?:\.[\w-]+)+)"/g,
			),
		].map((match) => match[1].replace(/^common:/, "")),
	),
);

describe("shared shell catalog", () => {
	it.each(ALL_LANGUAGES)(
		"covers shell consumers, metadata, aliases and dynamic families in %s",
		async (locale) => {
			const complete = await loadCompleteServerTranslations(locale);
			const completeSlice = await loadCatalogSlice(locale, ALL_NAMESPACES);
			const shell = await loadShellTranslations(locale);
			expect(shell.locale).toBe(locale);
			// Partial projections must never make a full feature namespace look ready.
			expect(shell.namespaces).toEqual([]);
			for (const metadata of [...APP_ROUTE_METADATA, UNKNOWN_ROUTE_METADATA]) {
				const path = metadata.titleKey.split(".");
				expect(getPath(complete[locale], path), metadata.titleKey).toEqual(
					expect.any(String),
				);
				expect(getPath(shell.records[locale], path), metadata.titleKey).toEqual(
					getPath(complete[locale], path),
				);
			}
			for (const key of consumerKeys) {
				const expected = getPath(complete[locale], key.split("."));
				if (expected !== undefined)
					expect(getPath(shell.records[locale], key.split(".")), key).toEqual(
						expected,
					);
			}
			for (const { namespace, path } of SHELL_CATALOG_KEYS) {
				expect(getPath(shell.records[locale], path), path.join(".")).toEqual(
					getPath(complete[locale], path),
				);
				if (namespace !== "common") {
					const alias = [`${namespace}:${path[0]}`, ...path.slice(1)];
					expect(
						getPath(shell.records[locale], alias),
						alias.join("."),
					).toEqual(getPath(complete[locale], alias));
				}
			}
			for (const path of [
				"nav",
				"user",
				"appSearch",
				"notifications.content",
				"offline",
				"timeTracking.errors",
				"organization.role",
				"organization.slugErrors",
				"dashboard.customize",
			]) {
				expect(getPath(shell.records[locale], path.split(".")), path).toEqual(
					getPath(complete[locale], path.split(".")),
				);
			}
			expect(
				getPath(shell.records[locale], ["reports", "projects", "title"]),
			).toEqual(getPath(complete[locale], ["reports", "projects", "title"]));
			expect(
				getPath(complete[locale], ["reports", "projects", "budget"]),
			).toBeDefined();
			expect(
				getPath(shell.records[locale], ["reports", "projects", "budget"]),
			).toBeUndefined();
			for (const [encoded, owner] of Object.entries(shell.keyOwners)) {
				expect(getPath(shell.records[locale], JSON.parse(encoded))).toEqual(
					expect.any(String),
				);
				expect(owner).toEqual(expect.any(String));
				expect(owner).toBe(completeSlice.keyOwners[encoded]);
			}
			const serializedShellBytes = Buffer.byteLength(JSON.stringify(shell));
			expect(shell.keyOwners['["common","more"]']).toBe("teamsBot");
			expect(SHELL_CATALOG_KEYS).toContainEqual({
				namespace: "teamsBot",
				path: ["common", "more"],
			});
			const serializedCompleteBytes = Buffer.byteLength(
				JSON.stringify(complete),
			);
			expect(serializedShellBytes).toBeLessThan(serializedCompleteBytes);
			process.stdout.write(
				"CATALOG_BYTES " +
					JSON.stringify({
						locale,
						shell: serializedShellBytes,
						complete: serializedCompleteBytes,
						owners: Buffer.byteLength(JSON.stringify(shell.keyOwners)),
					}) +
					"\n",
			);
		},
	);
});
