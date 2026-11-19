/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AppAbility,
	createEmptyAbility,
	defineAbilityFor,
} from "@/lib/authorization";
import { SuspendedBillingContent } from "./suspended-billing-content";

let ability: AppAbility | null;
let organizationId: string | null = "org-1";
vi.mock("@/lib/auth-helpers", () => ({ getAbility: async () => ability }));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/auth/render-context", () => ({
	getRenderOrganizationIdentity: async () =>
		organizationId ? { organizationId } : null,
	getRenderUserOrganizations: async () => [
		{ id: "other-org", name: "Other organization" },
		{ id: "org-1", name: "Example organization" },
	],
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, ...props }: ComponentProps<"a">) => (
		<a href={`/de${href}`} {...props} />
	),
}));

beforeEach(() => {
	organizationId = "org-1";
	ability = defineAbilityFor({
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: {
			organizationId: "org-1",
			role: "admin",
			status: "approved",
		},
		employee: null,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	});
});
afterEach(cleanup);

const layoutPath = "src/app/[locale]/(app)/app-layout-content.tsx";
const billingSettingsPath = "src/app/[locale]/(app)/settings/billing/page.tsx";

describe("suspended billing recovery route", () => {
	it("offers contact guidance when ability and active organization identity are unavailable", async () => {
		ability = null;
		organizationId = null;
		render(await SuspendedBillingContent());
		expect(
			screen.getByRole("heading", { level: 1, name: "Organization suspended" }),
		).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
		expect(screen.getByText(/Contact an organization admin/)).toBeTruthy();
		expect(screen.queryByText("Example organization")).toBeNull();
		expect(screen.queryByText("Other organization")).toBeNull();
	});
	it("names the recovery task and active organization with a localized billing escape link", async () => {
		render(await SuspendedBillingContent());
		expect(
			screen.getByRole("heading", { level: 1, name: "Organization suspended" }),
		).toBeTruthy();
		expect(screen.getByText("Example organization")).toBeTruthy();
		expect(screen.queryByText("Other organization")).toBeNull();
		expect(
			screen.getByRole("link", { name: "Go to billing" }).getAttribute("href"),
		).toBe("/de/settings/billing");
	});

	it("explains the access consequence and directs a restricted actor to an organization admin", async () => {
		ability = createEmptyAbility();
		render(await SuspendedBillingContent());
		expect(
			screen.getByText(
				"Access to this organization is paused until billing is updated.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"This organization is suspended. Contact an organization admin to update billing.",
			),
		).toBeTruthy();
		expect(screen.queryByRole("link")).toBeNull();
	});

	it("redirects suspended organizations away from normal app pages but exempts recovery paths", () => {
		const layoutSource = readFileSync(join(process.cwd(), layoutPath), "utf8");

		expect(layoutSource).toContain("const isBillingRecoveryPath =");
		expect(layoutSource).toContain("/billing/suspended");
		expect(layoutSource).toContain("/settings/billing");
		expect(layoutSource).toContain("billingAccess.canAccess === false");
		expect(layoutSource).toContain("!isBillingRecoveryPath");
		expect(layoutSource).toContain('redirectWithLocale("/billing/suspended")');
	});

	it("fails closed when the app layout billing check fails", () => {
		const layoutSource = readFileSync(join(process.cwd(), layoutPath), "utf8");

		expect(layoutSource).not.toContain(".catch(() => billingDisabledAccess)");
		expect(layoutSource).not.toMatch(
			/catch\s*\([^)]*\)\s*=>\s*\(\s*\{\s*canAccess:\s*true/,
		);
		expect(layoutSource).toContain("billingCheckFailedAccess");
		expect(layoutSource).toContain("canAccess: false");
		expect(layoutSource).toContain('state: "suspended"');
		expect(layoutSource).toContain('reason: "subscription_required"');
		expect(layoutSource).toContain('status: "billing_check_failed"');
	});

	it("keeps the billing settings page from defaulting to allowed access on billing check failure", () => {
		const billingSettingsSource = readFileSync(
			join(process.cwd(), billingSettingsPath),
			"utf8",
		);

		expect(billingSettingsSource).not.toContain(
			"let accessResult = { canAccess: true }",
		);
		expect(billingSettingsSource).not.toMatch(
			/catch\s*\{[\s\S]*accessResult\s*=\s*\{\s*canAccess:\s*true/,
		);
		expect(billingSettingsSource).toContain("billingCheckFailedAccess");
		expect(billingSettingsSource).toContain("canAccess: false");
		expect(billingSettingsSource).toContain('state: "suspended"');
		expect(billingSettingsSource).toContain('reason: "subscription_required"');
		expect(billingSettingsSource).toContain('status: "billing_check_failed"');
	});

	it("defines suspended billing messages in the loaded common namespace", () => {
		const expectedEnglish = {
			title: "Organization suspended",
			accessConsequence: "Access to this organization is paused until billing is updated.",
			adminDescription:
				"Your trial ended or subscription is no longer valid. Update billing to continue using Z8.",
			memberDescription:
				"This organization is suspended. Contact an organization admin to update billing.",
			goToBilling: "Go to billing",
		};

		for (const locale of ["de", "en", "es", "fr", "it", "pt"]) {
			const messages = JSON.parse(
				readFileSync(
					join(process.cwd(), `messages/common/${locale}.json`),
					"utf8",
				),
			);
			expect(messages.billing.suspended).toBeDefined();
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(
				false,
			);
		}

		const englishMessages = JSON.parse(
			readFileSync(join(process.cwd(), "messages/common/en.json"), "utf8"),
		);
		expect(englishMessages.billing.suspended).toEqual(expectedEnglish);
	});
});
