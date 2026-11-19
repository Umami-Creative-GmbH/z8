/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireUser: vi.fn(),
	getCurrentSettingsAccessTier: vi.fn(),
	findUser: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mockState.requireUser,
	getCurrentSettingsAccessTier: mockState.getCurrentSettingsAccessTier,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/db", () => ({
	db: { query: { user: { findFirst: mockState.findUser } } },
}));
vi.mock("@/db/auth-schema", () => ({ user: { id: "user.id" } }));
vi.mock("@/env", () => ({ env: {} }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
}));
vi.mock("@/components/ui/page-header", () => ({
	PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/settings/auth/passkey-management", () => ({ PasskeyManagement: () => null }));
vi.mock("@/components/settings/auth/password-change-form", () => ({
	PasswordChangeForm: () => null,
}));
vi.mock("@/components/settings/auth/session-management", () => ({
	SessionManagement: () => null,
}));
vi.mock("@/components/settings/auth/social-accounts", () => ({ SocialAccounts: () => null }));
vi.mock("@/components/settings/auth/two-factor-setup", () => ({ TwoFactorSetup: () => null }));
vi.mock("@/components/settings/kiosk/own-kiosk-fob-card", () => ({ OwnKioskFobCard: () => null }));
vi.mock("@/components/settings/kiosk/own-kiosk-pin-card", () => ({ OwnKioskPinCard: () => null }));

const { default: SecuritySettingsPage } = await import("./page");

const POLICY_LINK = "Organization authentication policy (owners/admins)";

async function renderPage() {
	render(await SecuritySettingsPage());
}

describe("SecuritySettingsPage organization policy link", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireUser.mockResolvedValue({
			user: { id: "user-1", email: "user@example.com" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.findUser.mockResolvedValue({ twoFactorEnabled: false });
	});

	it("shows the policy link to organization owners and admins", async () => {
		mockState.getCurrentSettingsAccessTier.mockResolvedValue("orgAdmin");
		await renderPage();

		expect(screen.getByRole("link", { name: POLICY_LINK }).getAttribute("href")).toBe(
			"/settings/enterprise/identity-setup?tab=local-mfa",
		);
		expect(
			screen.getByRole("link", {
				name: "Verify authentication and review organization requirements",
			}),
		).toBeTruthy();
	});

	it.each(["manager", "member", null])("hides the policy link for the %s tier", async (tier) => {
		mockState.getCurrentSettingsAccessTier.mockResolvedValue(tier);
		await renderPage();

		expect(screen.queryByRole("link", { name: POLICY_LINK })).toBeNull();
		expect(
			screen.getByRole("link", {
				name: "Verify authentication and review organization requirements",
			}),
		).toBeTruthy();
	});

	it("hides the policy link when the access lookup fails", async () => {
		mockState.getCurrentSettingsAccessTier.mockRejectedValue(new Error("db down"));
		await renderPage();

		expect(screen.queryByRole("link", { name: POLICY_LINK })).toBeNull();
	});
});
