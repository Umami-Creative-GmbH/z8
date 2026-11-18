/* @vitest-environment jsdom */
import { screen, waitFor, within } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	billing: "false",
	counts: [209, 3, 2, 1],
	read: 0,
	denied: false,
	metricsFailed: false,
	analyticsFailed: false,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/navigation", () => ({
	Link: ({ href, ...props }: React.ComponentProps<"a">) => <a href={href} {...props} />,
}));
vi.mock("@/env", () => ({
	env: {
		get BILLING_ENABLED() {
			return state.billing;
		},
	},
}));
vi.mock("@/db", () => ({
	db: {
		select: () => ({
			from: () => {
				if (state.metricsFailed) throw Error("read failed");
				const value = state.counts[state.read++];
				const rows =
					value === undefined
						? [
								{
									currentSeats: 8,
									currentKioskSeats: 5,
									billingInterval: "month",
									status: "active",
								},
							]
						: [{ totalUsers: value, bannedUsers: value, totalOrgs: value, suspendedOrgs: value }];
				return Object.assign(Promise.resolve(rows), { where: () => Promise.resolve(rows) });
			},
		}),
	},
}));
vi.mock("@/lib/platform-analytics/service", () => ({
	getPlatformAnalyticsData: async () => {
		if (state.analyticsFailed) throw Error("read failed");
		return {};
	},
}));
vi.mock("@/components/platform-admin/platform-analytics-charts", () => ({
	PlatformAnalyticsPreviewCharts: () => <a href="/platform-admin/analytics">View full analytics</a>,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: "platform-operator", role: "admin" },
			session: { id: "platform-session" },
		},
		isPending: false,
	}),
	authClient: { $store: { atoms: { session: { subscribe: () => () => {} } } } },
}));
vi.mock("@/lib/effect/services/platform-admin.service", () => ({
	requirePlatformAdminSession: async () => {
		if (state.denied) throw Error("denied");
		return { userId: "platform-operator", sessionId: "platform-session" };
	},
}));

import Page from "./page";

async function openOverview() {
	// Static prerender waits for async server children, unlike streamed insertion scripts in jsdom.
	const { prelude } = await prerender(<Page />);
	const dom = new JSDOM(await new Response(prelude).text(), {
		runScripts: "dangerously",
		pretendToBeVisual: true,
	});
	// Run React's own streamed insertion instructions, never a hand-built replacement tree.
	await waitFor(() => expect(dom.window.document.querySelector('template[id^="B:"]')).toBeNull());
	document.body.innerHTML = dom.window.document.body.innerHTML;
	dom.window.close();
}

describe("platform overview composition", () => {
	beforeEach(() => {
		state.billing = "false";
		state.read = 0;
		state.denied = false;
		state.metricsFailed = false;
		state.analyticsFailed = false;
		document.body.innerHTML = "";
	});
	it("names platform scope and groups the existing workflows by task", async () => {
		await openOverview();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Platform overview");
		const access = screen.getByRole("navigation", { name: "Access management" });
		expect(
			within(access)
				.getByRole("link", { name: /User Management/ })
				.getAttribute("href"),
		).toBe("/platform-admin/users");
		expect(
			within(access)
				.getByRole("link", { name: /Organization Management/ })
				.getAttribute("href"),
		).toBe("/platform-admin/organizations");
		const operations = screen.getByRole("navigation", { name: "Platform operations" });
		expect(
			within(operations)
				.getAllByRole("link")
				.map((link) => link.getAttribute("href")),
		).toEqual(["/platform-admin/diagnostics", "/platform-admin/system-email-templates"]);
	});
	it("retains each operational deep link and exact status filter", async () => {
		await openOverview();
		const metrics = screen.getByRole("region", { name: "Platform Metrics" });
		expect(
			within(metrics)
				.getAllByRole("link")
				.map((link) => ({ href: link.getAttribute("href"), text: link.textContent })),
		).toEqual([
			{ href: "/platform-admin/users", text: "Total Users209Registered platform accounts" },
			{ href: "/platform-admin/users?status=banned", text: "Banned Users3Restricted from access" },
			{ href: "/platform-admin/organizations", text: "Organizations2Active workspaces" },
			{
				href: "/platform-admin/organizations?status=suspended",
				text: "Suspended1Read-only organizations",
			},
		]);
		expect(screen.queryByRole("navigation", { name: "Billing and subscriptions" })).toBeNull();
		expect(screen.queryByRole("link", { name: /Licensed Seats/ })).toBeNull();
	});
	it("uses the authoritative full/kiosk revenue and licensed seat values when billing is enabled", async () => {
		state.billing = "true";
		await openOverview();
		expect(screen.getByRole("link", { name: /MRR/ }).textContent).toContain("MRR22Monthly");
		expect(screen.getByRole("link", { name: /Licensed Seats/ }).textContent).toContain("8");
		expect(
			within(screen.getByRole("navigation", { name: "Billing and subscriptions" }))
				.getByRole("link")
				.getAttribute("href"),
		).toBe("/platform-admin/billing");
	});
	it("keeps destinations and analytics usable when counts are unavailable, without false zero values", async () => {
		state.metricsFailed = true;
		await openOverview();
		expect(screen.getByRole("alert").textContent).toContain("Platform metrics are unavailable");
		expect(screen.getByRole("link", { name: "View full analytics" })).toBeTruthy();
		expect(screen.getByRole("navigation", { name: "Access management" })).toBeTruthy();
		expect(
			within(screen.getByRole("region", { name: "Platform Metrics" })).queryByRole("link"),
		).toBeNull();
	});
	it("keeps counts and destinations usable when analytics fails", async () => {
		state.analyticsFailed = true;
		await openOverview();
		expect(screen.getByRole("alert").textContent).toContain("Platform analytics are unavailable");
		expect(screen.getByRole("link", { name: /Total Users 209/ })).toBeTruthy();
	});
	it("shows a safe heading without starting global reads when canonical admission refuses", async () => {
		state.denied = true;
		await openOverview();
		expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Platform overview");
		expect(screen.queryByRole("link")).toBeNull();
		expect(state.read).toBe(0);
	});
});
