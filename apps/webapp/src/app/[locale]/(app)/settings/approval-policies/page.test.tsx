/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getCurrentSettingsAccess: vi.fn(),
	getRenderOrganizationAbility: vi.fn(),
	loadApprovalSettings: vi.fn(),
	getEffectiveApprovalTriagePolicy: vi.fn(),
	redirectWithLocale: vi.fn((href: string) => {
		throw new Error(`redirect:${href}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: mocks.getCurrentSettingsAccess,
}));
vi.mock("@/lib/auth/render-context", () => ({
	getRenderOrganizationAbility: mocks.getRenderOrganizationAbility,
}));
vi.mock("@/lib/approvals/approval-settings", () => ({
	loadApprovalSettings: mocks.loadApprovalSettings,
}));
vi.mock("@/lib/approvals/triage-policy", () => ({
	getEffectiveApprovalTriagePolicy: mocks.getEffectiveApprovalTriagePolicy,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("next/navigation", async () => {
	const { useSyncExternalStore } = await import("react");
	const listeners = new Set<() => void>();
	const replaceState = window.history.replaceState.bind(window.history);
	window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
		replaceState(...args);
		for (const listener of listeners) listener();
	};
	return {
		useSearchParams: () =>
			new URLSearchParams(
				useSyncExternalStore(
					(listener) => {
						listeners.add(listener);
						return () => {
							listeners.delete(listener);
						};
					},
					() => window.location.search,
				),
			),
	};
});
vi.mock("@/components/settings/approval-policy/approval-policy-management", () => ({
	ApprovalPolicyManagement: ({ organizationId }: { organizationId: string }) => (
		<input aria-label="Policy draft" data-org={organizationId} defaultValue="" />
	),
}));
vi.mock("@/components/settings/employee-group-management", () => ({
	EmployeeGroupManagement: ({ organizationId }: { organizationId: string }) => (
		<p data-org={organizationId}>Employee groups panel</p>
	),
}));
vi.mock("@/components/settings/approval-settings/triage-settings-form", () => ({
	ApprovalTriageSettingsForm: () => <p>Triage panel</p>,
}));
vi.mock("@/components/settings/approval-escalation/approval-escalation-management", () => ({
	ApprovalEscalationManagement: ({
		organizationId,
		section,
	}: {
		organizationId: string;
		section: string;
	}) => <p data-org={organizationId}>{`${section} panel`}</p>,
}));
vi.mock("@/components/settings/approval-escalation/deputy-decisions-setting", () => ({
	DeputyDecisionsSetting: ({ enabled }: { enabled: boolean }) => (
		<span data-enabled={String(enabled)}>Deputy decisions</span>
	),
}));

import ApprovalSettingsPage from "./page";

function caller(
	settingsAccess: "member" | "scopedManager" | "orgAdmin" | "owner" | null = "orgAdmin",
	organizationId = "org-1",
) {
	return {
		userId: "user-1",
		organizationId,
		settingsAccess,
		membershipRole: settingsAccess ? "admin" : null,
		employee: null,
	};
}

async function content(page: ReturnType<typeof ApprovalSettingsPage>) {
	return page.props.children.type();
}

function tabValues(page: Awaited<ReturnType<typeof content>>) {
	return page.props.tabs.map((tab: { value: string }) => tab.value);
}

beforeEach(() => {
	vi.clearAllMocks();
	window.history.replaceState(null, "", "/en/settings/approval-policies");
	mocks.getEffectiveApprovalTriagePolicy.mockResolvedValue({
		staleAfterHours: 72,
		smallCorrectionMinutes: 15,
	});
	mocks.getCurrentSettingsAccess.mockResolvedValue(caller());
	mocks.getRenderOrganizationAbility.mockResolvedValue({ can: () => true });
	mocks.loadApprovalSettings.mockResolvedValue({
		deputyDecisionsEnabled: true,
	});
});

afterEach(() => {
	cleanup();
});

describe("combined Approval settings access and tabs", () => {
	it("composes all seven panels for an org admin who manages approvals", async () => {
		const page = await content(ApprovalSettingsPage());
		expect(page.key).toBe("org-1");
		expect(page.props.measure).toBe(true);
		expect(tabValues(page)).toEqual([
			"policies",
			"groups",
			"triage",
			"escalation",
			"attention",
			"channels",
			"history",
		]);
		const tabByValue = Object.fromEntries(
			page.props.tabs.map((tab: { value: string; panel: unknown }) => [tab.value, tab.panel]),
		);
		for (const tab of ["policies", "groups", "attention", "channels", "history"]) {
			expect(tabByValue[tab].props.organizationId).toBe("org-1");
		}
		expect(tabByValue.escalation.props.children[0].props.organizationId).toBe("org-1");
		expect(tabByValue.escalation.props.children[1].props.enabled).toBe(true);
	});

	it("withholds escalation panels and data from admins without approval management permission", async () => {
		mocks.getRenderOrganizationAbility.mockResolvedValue({ can: () => false });
		const page = await content(ApprovalSettingsPage());
		expect(tabValues(page)).toEqual(["policies", "groups", "triage"]);
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});

	it("preserves escalation access through custom permissions without exposing org-admin triage settings", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue(caller("member"));
		const page = await content(ApprovalSettingsPage());
		expect(tabValues(page)).toEqual(["escalation", "attention", "channels", "history"]);
		expect(mocks.getEffectiveApprovalTriagePolicy).not.toHaveBeenCalled();
	});

	it("redirects callers without either permission", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue(caller("member"));
		mocks.getRenderOrganizationAbility.mockResolvedValue({ can: () => false });
		await expect(content(ApprovalSettingsPage())).rejects.toThrow("redirect:/settings");
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});

	it("refuses former employees and unapproved members even if an ability exists", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue(caller(null));
		await expect(content(ApprovalSettingsPage())).rejects.toThrow("redirect:/settings");
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});

	it("requires an active organization", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue(null);
		await expect(content(ApprovalSettingsPage())).rejects.toThrow("redirect:/settings");
		expect(mocks.loadApprovalSettings).not.toHaveBeenCalled();
	});

	it("renders one page heading inside the shared measured frame with horizontal tab scrolling and lazy panels", async () => {
		const { container } = render(await content(ApprovalSettingsPage()));
		const headings = screen.getAllByRole("heading", { level: 1 });
		expect(headings).toHaveLength(1);
		expect(headings[0]?.textContent).toBe("Approval");
		expect(container.querySelector(".page-frame .page-measure")).toBeTruthy();

		const tablist = screen.getByRole("tablist", { name: "Approval" });
		expect(tablist.parentElement?.className).toContain("max-w-full");
		expect(tablist.parentElement?.className).toContain("overflow-x-auto");

		expect(
			screen.getByRole("tab", { name: "Approval Policies" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByLabelText("Policy draft")).toBeTruthy();
		expect(screen.queryByText("escalation panel")).toBeNull();
		expect(screen.queryByText("Employee groups panel")).toBeNull();
	});

	it.each([
		["groups", "Employee groups panel"],
		["triage", "Triage panel"],
		["escalation", "escalation panel"],
		["attention", "attention panel"],
		["channels", "channels panel"],
		["history", "history panel"],
	] as const)("opens a direct link to %s", async (tab, expectedText) => {
		window.history.replaceState(null, "", `/en/settings/approval-policies?tab=${tab}`);
		render(await content(ApprovalSettingsPage()));
		expect(screen.getByRole("tabpanel").textContent).toContain(expectedText);
		expect(screen.queryByLabelText("Policy draft")).toBeNull();
	});

	it("falls back to the first authorized tab for unknown or unavailable tabs", async () => {
		mocks.getCurrentSettingsAccess.mockResolvedValue(caller("member"));
		window.history.replaceState(null, "", "/en/settings/approval-policies?tab=policies");
		render(await content(ApprovalSettingsPage()));
		expect(screen.getByRole("tabpanel").textContent).toContain("escalation panel");
		expect(screen.queryByRole("tab", { name: "Approval Policies" })).toBeNull();
	});

	it("retains unsaved edits, locale, unrelated search params and hash on tab changes", async () => {
		window.history.replaceState(null, "", "/de/settings/approval-policies?from=setup#details");
		render(await content(ApprovalSettingsPage()));

		fireEvent.change(screen.getByLabelText("Policy draft"), {
			target: { value: "Unsaved policy" },
		});
		fireEvent.click(screen.getByRole("tab", { name: "Employee Groups" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").textContent).toBe("Employee groups panel"),
		);
		expect(window.location.pathname).toBe("/de/settings/approval-policies");
		expect(window.location.hash).toBe("#details");
		expect(new URLSearchParams(window.location.search).get("from")).toBe("setup");
		expect(new URLSearchParams(window.location.search).get("tab")).toBe("groups");

		fireEvent.click(screen.getByRole("tab", { name: "Approval Policies" }));
		await waitFor(() =>
			expect(screen.getByRole("tabpanel").querySelector("input")?.value).toBe("Unsaved policy"),
		);
	});
});
