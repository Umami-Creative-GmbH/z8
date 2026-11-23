// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const refresh = vi.fn();
const toastSuccess = vi.fn();

// Resolves `{name}` and simple ICU plurals so assertions read the English copy people see.
function translate(_key: string, fallback: string, params: Record<string, unknown> = {}) {
	return fallback
		.replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_match, name, one, other) =>
			(params[name] === 1 ? one : other).replace("#", String(params[name])),
		)
		.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: translate }),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: (...args: unknown[]) => toastSuccess(...args) } }));

import type { OrganizationMfaCoverage } from "./coverage-model";
import { OrganizationMfaSettings } from "./settings";

const coverage: OrganizationMfaCoverage = {
	enabled: false,
	gracePeriodDays: 14,
	updatedAt: null,
	timezone: "Europe/Berlin",
	members: [
		{
			userId: "admin",
			name: "Ada Admin",
			email: "ada@example.com",
			isAdministrator: true,
			kioskOnly: false,
			methods: ["passkey", "totp"],
			deadline: null,
			enforced: false,
			lastQualifyingAccessAt: "2026-11-19T08:00:00Z",
		},
		{
			userId: "worker",
			name: "Wes Worker",
			email: "wes@example.com",
			isAdministrator: false,
			kioskOnly: false,
			methods: [],
			deadline: null,
			enforced: false,
			lastQualifyingAccessAt: null,
		},
	],
};

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

const fetchMock = vi.fn();
beforeEach(() => {
	vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	fetchMock.mockReset();
	refresh.mockReset();
	toastSuccess.mockReset();
});

it("keeps saving unavailable until the policy changes, and offers to discard the change", async () => {
	render(<OrganizationMfaSettings organizationId="org" initial={coverage} />, { wrapper });
	const save = screen.getByRole<HTMLButtonElement>("button", { name: "Save policy" });
	expect(save.disabled).toBe(true);
	await userEvent.click(screen.getByRole("radio", { name: /7 days/ }));
	expect(save.disabled).toBe(false);
	expect(screen.getByText("Unsaved changes")).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(save.disabled).toBe(true);
});

it("shows activation safeguards only when turning the requirement on and requires the recovery acknowledgement", async () => {
	render(<OrganizationMfaSettings organizationId="org" initial={coverage} />, { wrapper });
	expect(screen.queryByText("Before you turn this on")).toBeNull();
	await userEvent.click(
		screen.getByRole("switch", { name: "Require an authenticator for local sign-ins" }),
	);
	expect(screen.getByText("Before you turn this on")).toBeTruthy();
	await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
	expect((await screen.findByRole("alert")).textContent).toContain(
		"Confirm your sign-in route and recovery",
	);
	expect(fetchMock).not.toHaveBeenCalled();
	const recovery = screen.getByRole("checkbox", {
		name: "I have verified my sign-in route and arranged recovery.",
	});
	expect(document.activeElement).toBe(recovery);
});

it("explains an expired verification and links back to this tab after verifying", async () => {
	fetchMock.mockResolvedValue(
		new Response(JSON.stringify({ error: "MFA_RECENT_VERIFICATION_REQUIRED" }), { status: 403 }),
	);
	render(<OrganizationMfaSettings organizationId="org" initial={coverage} />, { wrapper });
	await userEvent.click(
		screen.getByRole("switch", { name: "Require an authenticator for local sign-ins" }),
	);
	await userEvent.click(
		screen.getByRole("checkbox", {
			name: "I have verified my sign-in route and arranged recovery.",
		}),
	);
	await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
	const alert = await screen.findByRole("alert");
	expect(alert.textContent).toContain("older than five minutes");
	expect(alert.textContent).not.toContain("MFA_RECENT_VERIFICATION_REQUIRED");
	const link = within(alert).getByRole<HTMLAnchorElement>("link", { name: "Verify now" });
	const url = new URL(link.href, "http://localhost");
	expect(url.pathname).toBe("/mfa");
	expect(url.searchParams.get("organizationId")).toBe("org");
	expect(url.searchParams.get("callbackUrl")).toBe(
		"/settings/enterprise/identity-setup?tab=local-mfa",
	);
	const [, init] = fetchMock.mock.calls[0];
	expect(JSON.parse(init.body)).toEqual({
		organizationId: "org",
		enabled: true,
		gracePeriodDays: 14,
		recoveryAcknowledged: true,
		soleAdminLockoutAcknowledged: false,
	});
});

it("confirms a successful save and refreshes the coverage", async () => {
	fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
	render(
		<OrganizationMfaSettings organizationId="org" initial={{ ...coverage, enabled: true }} />,
		{
			wrapper,
		},
	);
	await userEvent.click(screen.getByRole("radio", { name: /30 days/ }));
	await userEvent.click(screen.getByRole("button", { name: "Save policy" }));
	await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Local MFA requirement saved"));
	expect(refresh).toHaveBeenCalled();
});

it("filters the member table to members who need attention", async () => {
	render(<OrganizationMfaSettings organizationId="org" initial={coverage} />, { wrapper });
	const table = screen.getByRole("table");
	expect(within(table).getByText("Ada Admin")).toBeTruthy();
	await userEvent.click(screen.getByRole("radio", { name: /Needs attention/ }));
	expect(within(table).queryByText("Ada Admin")).toBeNull();
	expect(within(table).getByText("Wes Worker")).toBeTruthy();
	await userEvent.type(
		screen.getByRole("searchbox", { name: "Search by name or email" }),
		"nobody",
	);
	expect(await within(table).findByText("No members match this view.")).toBeTruthy();
	await userEvent.click(within(table).getByRole("button", { name: "Show all members" }));
	expect(within(table).getByText("Ada Admin")).toBeTruthy();
});
