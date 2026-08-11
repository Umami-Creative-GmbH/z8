/* @vitest-environment jsdom */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { TrialBanner } from "./trial-banner";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, number>) =>
			fallback.replace("{days}", String(params?.days)),
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({
		children,
		href,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

describe("TrialBanner", () => {
	it("renders trial messaging and upgrade link when billing management is allowed", () => {
		render(
			<TrialBanner
				daysRemaining={9}
				billingHref="/en/settings/billing"
				showUpgradeButton={true}
			/>,
		);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(
			screen.getByText(
				"9 days remaining. Add payment details now; your paid subscription starts after the trial.",
			),
		).toBeTruthy();

		const link = screen.getByRole("link", { name: "Upgrade" });
		expect(link.getAttribute("href")).toBe("/en/settings/billing");
	});

	it("hides the upgrade link when billing management is not allowed", () => {
		render(
			<TrialBanner
				daysRemaining={9}
				billingHref="/en/settings/billing"
				showUpgradeButton={false}
			/>,
		);

		expect(screen.getByText("14-day trial active")).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Upgrade" })).toBeNull();
	});

	it("can be dismissed for the current page session", () => {
		render(
			<TrialBanner
				daysRemaining={9}
				billingHref="/en/settings/billing"
				showUpgradeButton={true}
			/>,
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Dismiss trial banner" }),
		);
		fireEvent.transitionEnd(screen.getByRole("complementary"));

		expect(screen.queryByText("14-day trial active")).toBeNull();
	});

	it("uses the localized app navigation link", () => {
		const bannerSource = readFileSync(
			join(process.cwd(), "src/components/billing/trial-banner.tsx"),
			"utf8",
		);

		expect(bannerSource).toContain('import { Link } from "@/navigation"');
		expect(bannerSource).not.toContain("<a\n");
		expect(bannerSource).toContain("<Link");
	});

	it("defines trial banner messages for supported locales", () => {
		const expectedEnglish = {
			title: "14-day trial active",
			description:
				"{days} days remaining. Add payment details now; your paid subscription starts after the trial.",
			upgrade: "Upgrade",
			dismiss: "Dismiss trial banner",
		};

		for (const locale of ["de", "en", "es", "fr", "it", "pt"]) {
			const commonMessages = JSON.parse(
				readFileSync(
					join(process.cwd(), `messages/common/${locale}.json`),
					"utf8",
				),
			);
			expect(commonMessages.billing.trialBanner).toMatchObject({
				title: expect.any(String),
				description: expect.any(String),
				upgrade: expect.any(String),
				dismiss: expect.any(String),
			});
			expect(existsSync(join(process.cwd(), `messages/${locale}.json`))).toBe(
				false,
			);
		}

		const englishMessages = JSON.parse(
			readFileSync(join(process.cwd(), "messages/common/en.json"), "utf8"),
		);
		expect(englishMessages.billing.trialBanner).toEqual(expectedEnglish);
	});

	it("is wired into the app layout billing access flow", () => {
		const coordinatorSource = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/layout.tsx"),
			"utf8",
		);
		const layoutContentSource = readFileSync(
			join(process.cwd(), "src/app/[locale]/(app)/app-layout-content.tsx"),
			"utf8",
		);

		expect(coordinatorSource).toContain(
			'import { AuthenticatedAppContent } from "./app-layout-content"',
		);
		expect(coordinatorSource).toMatch(
			/<AuthenticatedAppContent params=\{params\}>[\s\S]*\{children\}[\s\S]*<\/AuthenticatedAppContent>/,
		);
		expect(layoutContentSource).toContain("@/components/billing/trial-banner");
		expect(layoutContentSource).toContain("BillingEnforcementService");
		expect(layoutContentSource).toContain(
			"activeOrganizationId = session.session?.activeOrganizationId",
		);
		expect(layoutContentSource).toContain(
			"checkBillingAccess(activeOrganizationId)",
		);
		expect(layoutContentSource).toContain("<TrialBanner");
		expect(layoutContentSource).toContain('billingAccess.state === "trialing"');
		expect(layoutContentSource).toContain(
			'import { and, eq } from "drizzle-orm"',
		);
		expect(layoutContentSource).toContain('import { db } from "@/db"');
		expect(layoutContentSource).toContain(
			'import { member } from "@/db/auth-schema"',
		);
		expect(layoutContentSource).toMatch(
			/import \{[^}]*\bsubscription\b[^}]*\} from "@\/db\/schema"/,
		);
		expect(layoutContentSource).toContain("member.userId");
		expect(layoutContentSource).toContain("member.organizationId");
		expect(layoutContentSource).toContain(
			'membershipRole === "owner" || membershipRole === "admin"',
		);
		expect(layoutContentSource).toContain(
			'subscriptionRow?.status === "trialing"',
		);
		expect(layoutContentSource).toContain(
			"Boolean(subscriptionRow?.stripeSubscriptionId)",
		);
		expect(layoutContentSource).toContain("!hasPreparedTrialSubscription");
		expect(layoutContentSource).toContain(
			"showUpgradeButton={canManageBilling}",
		);
	});
});
