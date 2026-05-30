/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = "src/app/[locale]/(app)/billing/suspended/page.tsx";
const layoutPath = "src/app/[locale]/(app)/layout.tsx";
const billingSettingsPath = "src/app/[locale]/(app)/settings/billing/page.tsx";

describe("suspended billing recovery route", () => {
	it("defines the suspended route with localized admin and member recovery states", () => {
		const absoluteRoutePath = join(process.cwd(), routePath);

		expect(existsSync(absoluteRoutePath)).toBe(true);

		const pageSource = readFileSync(absoluteRoutePath, "utf8");

		expect(pageSource).toContain("getTranslate()");
		expect(pageSource).toContain("getAbility()");
		expect(pageSource).toContain('ability?.can("manage", "OrgBilling")');
		expect(pageSource).toContain("billing.suspended.title");
		expect(pageSource).toContain("billing.suspended.adminDescription");
		expect(pageSource).toContain("billing.suspended.memberDescription");
		expect(pageSource).toContain("billing.suspended.goToBilling");
		expect(pageSource).toContain('href="/settings/billing"');
		expect(pageSource).toContain("canManageBilling ?");
	});

	it("redirects suspended organizations away from normal app pages but exempts recovery paths", () => {
		const layoutSource = readFileSync(join(process.cwd(), layoutPath), "utf8");

		expect(layoutSource).toContain("const isBillingRecoveryPath =");
		expect(layoutSource).toContain("/billing/suspended");
		expect(layoutSource).toContain("/settings/billing");
		expect(layoutSource).toContain("billingAccess.canAccess === false");
		expect(layoutSource).toContain("!isBillingRecoveryPath");
		expect(layoutSource).toContain("redirect(`/${locale}/billing/suspended`)");
	});

	it("fails closed when the app layout billing check fails", () => {
		const layoutSource = readFileSync(join(process.cwd(), layoutPath), "utf8");

		expect(layoutSource).not.toContain(".catch(() => billingDisabledAccess)");
		expect(layoutSource).not.toMatch(/catch\s*\([^)]*\)\s*=>\s*\(\s*\{\s*canAccess:\s*true/);
		expect(layoutSource).toContain("billingCheckFailedAccess");
		expect(layoutSource).toContain("canAccess: false");
		expect(layoutSource).toContain('state: "suspended"');
		expect(layoutSource).toContain('reason: "subscription_required"');
		expect(layoutSource).toContain('status: "billing_check_failed"');
	});

	it("keeps the billing settings page from defaulting to allowed access on billing check failure", () => {
		const billingSettingsSource = readFileSync(join(process.cwd(), billingSettingsPath), "utf8");

		expect(billingSettingsSource).not.toContain("let accessResult = { canAccess: true }");
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
			adminDescription:
				"Your trial ended or subscription is no longer valid. Update billing to continue using Z8.",
			memberDescription:
				"This organization is suspended. Contact an organization admin to update billing.",
			goToBilling: "Go to billing",
		};

		for (const locale of ["de", "en", "es", "fr", "it", "pt"]) {
			const messages = JSON.parse(
				readFileSync(join(process.cwd(), `messages/common/${locale}.json`), "utf8"),
			);
			expect(messages.billing.suspended).toBeDefined();
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(false);
		}

		const englishMessages = JSON.parse(
			readFileSync(join(process.cwd(), "messages/common/en.json"), "utf8"),
		);
		expect(englishMessages.billing.suspended).toEqual(expectedEnglish);
	});
});
