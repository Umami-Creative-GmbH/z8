/* @vitest-environment jsdom */

import { existsSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LicensesLayout from "./layout";
import layoutSource from "./layout.tsx?raw";
import pageSource from "./page.tsx?raw";

const boundaryProps = vi.hoisted(() => ({
	route: null as string | null,
	params: null as Promise<{ locale: string }> | null,
	count: 0,
}));

vi.mock("@/tolgee/route-boundary", () => ({
	RouteTranslationBoundary: ({
		route,
		params,
		children,
	}: {
		route: string;
		params: Promise<{ locale: string }>;
		children: React.ReactNode;
	}) => {
		boundaryProps.route = route;
		boundaryProps.params = params;
		boundaryProps.count += 1;
		return (
			<div data-testid="route-boundary" data-route={route}>
				{children}
			</div>
		);
	},
}));

vi.mock("@/components/auth-shell-controls", () => ({
	AuthShellControls: () => (
		<>
			<button type="button">Theme</button>
			<button type="button">Font size</button>
			<button type="button">Language</button>
		</>
	),
}));

vi.mock("@/components/info-footer", () => ({
	InfoFooter: () => <footer>Info footer</footer>,
}));

describe("LicensesLayout", () => {
	it("renders a single /licenses translation boundary, static surface, utility controls, max-w-5xl container, and InfoFooter", () => {
		boundaryProps.route = null;
		boundaryProps.params = null;
		boundaryProps.count = 0;

		const params = Promise.resolve({ locale: "en" });
		render(
			<LicensesLayout params={params}>
				<div data-testid="license-content">License table content</div>
			</LicensesLayout>,
		);

		expect(boundaryProps.count).toBe(1);
		expect(boundaryProps.route).toBe("/licenses");
		expect(boundaryProps.params).toBe(params);
		expect(screen.getAllByTestId("route-boundary")).toHaveLength(1);

		expect(screen.getByRole("button", { name: "Theme" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
		expect(screen.getByText("Info footer")).toBeTruthy();

		const content = screen.getByTestId("license-content");
		const container = content.parentElement;
		expect(container?.className).toContain("max-w-5xl");

		const main = content.closest("main");
		expect(main).toBeTruthy();

		const section = content.closest("section");
		expect(section?.className).toContain("pt-[max(1rem,env(safe-area-inset-top))]");
		expect(section?.className).toContain("pb-[env(safe-area-inset-bottom)]");

		const surface = section?.parentElement;
		expect(surface?.className).toContain("bg-background");
	});

	it("lives outside (auth) and avoids dynamic auth-shell, database, DomainAuthProvider, and Turnstile overhead", () => {
		expect(existsSync(path.resolve("src/app/[locale]/(auth)/licenses"))).toBe(false);
		expect(existsSync(path.resolve("src/app/[locale]/licenses/page.tsx"))).toBe(true);

		const combinedSource = `${layoutSource}\n${pageSource}`;
		const forbiddenReferences = [
			"connection(",
			"headers(",
			"AuthBackground",
			"DomainAuthProvider",
			"classifyDomainHost",
			"getDomainConfig",
			"getPlatformDomainConfig",
			"getCookieConsentScript",
			"Turnstile",
			"next/script",
		];

		for (const forbidden of forbiddenReferences) {
			expect(combinedSource, forbidden).not.toContain(forbidden);
		}
	});
});
