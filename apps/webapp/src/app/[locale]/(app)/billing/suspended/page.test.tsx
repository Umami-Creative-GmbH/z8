/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routePath = "src/app/[locale]/(app)/billing/suspended/page.tsx";
const layoutPath = "src/app/[locale]/(app)/layout.tsx";

describe("suspended billing recovery route", () => {
	it("defines the suspended route with localized admin and member recovery states", () => {
		const absoluteRoutePath = join(process.cwd(), routePath);

		expect(existsSync(absoluteRoutePath)).toBe(true);

		const pageSource = readFileSync(absoluteRoutePath, "utf8");

		expect(pageSource).toContain('getTranslate()');
		expect(pageSource).toContain('getAbility()');
		expect(pageSource).toContain('ability?.can("manage", "OrgBilling")');
		expect(pageSource).toContain('billing.suspended.title');
		expect(pageSource).toContain('billing.suspended.adminDescription');
		expect(pageSource).toContain('billing.suspended.memberDescription');
		expect(pageSource).toContain('billing.suspended.goToBilling');
		expect(pageSource).toContain('href="/settings/billing"');
		expect(pageSource).toContain('canManageBilling ?');
	});

	it("redirects suspended organizations away from normal app pages but exempts recovery paths", () => {
		const layoutSource = readFileSync(join(process.cwd(), layoutPath), "utf8");

		expect(layoutSource).toContain('const isBillingRecoveryPath =');
		expect(layoutSource).toContain('/billing/suspended');
		expect(layoutSource).toContain('/settings/billing');
		expect(layoutSource).toContain('billingAccess.canAccess === false');
		expect(layoutSource).toContain('!isBillingRecoveryPath');
		expect(layoutSource).toContain('redirect(`/${locale}/billing/suspended`)');
	});

	it("defines suspended billing messages for supported locales", () => {
		const expectedEnglish = {
			title: "Organization suspended",
			adminDescription:
				"Your trial ended or subscription is no longer valid. Update billing to continue using Z8.",
			memberDescription:
				"This organization is suspended. Contact an organization admin to update billing.",
			goToBilling: "Go to billing",
		};

		for (const locale of ["de", "en", "es", "fr", "it", "pt"]) {
			const messages = JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"));

			expect(messages.billing.suspended).toBeDefined();
		}

		const englishMessages = JSON.parse(readFileSync(join(process.cwd(), "messages/en.json"), "utf8"));
		expect(englishMessages.billing.suspended).toEqual(expectedEnglish);
	});
});
