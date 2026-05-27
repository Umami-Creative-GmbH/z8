import { describe, expect, it } from "vitest";

import { getNamespacesForRoute, loadNamespaces, TolgeeBase } from "@/tolgee/shared";

describe("route namespaces", () => {
	it("loads admin namespaces for /platform-admin", () => {
		expect(getNamespacesForRoute("/platform-admin")).toEqual(["common", "admin"]);
	});

	it("loads admin namespaces for /platform-admin/analytics", () => {
		expect(getNamespacesForRoute("/platform-admin/analytics")).toEqual(["common", "admin"]);
	});

	it("loads admin+settings namespaces for /platform-admin/worker-queue", () => {
		expect(getNamespacesForRoute("/platform-admin/worker-queue")).toEqual([
			"common",
			"admin",
			"settings/generic",
		]);
	});

	it("loads admin+settings namespaces for nested /platform-admin/worker-queue routes", () => {
		expect(getNamespacesForRoute("/platform-admin/worker-queue/jobs/123")).toEqual([
			"common",
			"admin",
			"settings/generic",
		]);
	});

	it("does not match /platform-admin prefix for /platform-administer", () => {
		expect(getNamespacesForRoute("/platform-administer")).toEqual(["common"]);
	});

	it("does not special-case legacy /admin", () => {
		expect(getNamespacesForRoute("/admin")).toEqual(["common"]);
	});

	it("loads common+settings namespaces for /travel-expenses", () => {
		expect(getNamespacesForRoute("/travel-expenses")).toEqual(["common", "travelExpenses"]);
	});

	it("loads the approvals namespace for approval routes", () => {
		expect(getNamespacesForRoute("/approvals/inbox")).toEqual(["common", "approvals"]);
	});

	it("loads the my requests namespace for my requests routes", () => {
		expect(getNamespacesForRoute("/my-requests")).toEqual(["common", "myRequests"]);
	});

	it("loads settings translations for team routes", () => {
		expect(getNamespacesForRoute("/team")).toEqual(["common", "team"]);
	});

	it("loads scheduling and compliance namespaces for scheduling routes", () => {
		expect(getNamespacesForRoute("/scheduling")).toEqual(["common", "scheduling", "compliance"]);
	});

	it("loads compliance translations for time tracking routes", () => {
		expect(getNamespacesForRoute("/time-tracking")).toEqual([
			"common",
			"timeTracking",
			"compliance",
		]);
	});

	it("loads webhooks translations only for webhook settings routes", () => {
		expect(getNamespacesForRoute("/settings/webhooks")).toEqual([
			"common",
			"settings/generic",
			"webhooks",
		]);
	});

	it("loads focused settings namespaces for nested settings routes", () => {
		expect(getNamespacesForRoute("/settings/billing")).toEqual([
			"common",
			"settings/generic",
			"billing",
		]);
		expect(getNamespacesForRoute("/settings/enterprise/email")).toEqual([
			"common",
			"settings/generic",
			"settings/enterprise",
		]);
		expect(getNamespacesForRoute("/settings/holidays")).toEqual([
			"common",
			"settings/generic",
			"settings/holidays",
		]);
	});

	it("loads setup translations for setup and init routes", () => {
		expect(getNamespacesForRoute("/setup")).toEqual(["common", "setup"]);
		expect(getNamespacesForRoute("/init")).toEqual(["common", "setup"]);
	});

	it("resolves namespace-prefixed route translations from static data", async () => {
		const staticData = await loadNamespaces("de", ["common", "myRequests"]);
		const tolgee = TolgeeBase().init({ language: "de", staticData });

		await tolgee.run();

		expect(tolgee.t("myRequests:myRequests.title", "My Requests")).toBe("Meine Anfragen");
	});

	it("loads teams bot translations as a registered namespace", async () => {
		const staticData = await loadNamespaces("de", ["teamsBot"]);
		const tolgee = TolgeeBase().init({ language: "de", staticData });

		await tolgee.run();

		expect(tolgee.t("teamsBot:commands.help.availableCommands", "Help")).not.toBe("Help");
	});
});
