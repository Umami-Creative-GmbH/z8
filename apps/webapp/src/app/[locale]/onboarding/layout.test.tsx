/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { isValidElement, Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import OnboardingLayout from "./layout";
import source from "./layout.tsx?raw";

vi.mock("next/image", () => ({
	default: ({ alt, className }: { alt: string; className?: string }) => (
		<img alt={alt} className={className} data-testid="onboarding-background" />
	),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@/components/info-footer", () => ({
	InfoFooter: () => <footer>Info footer</footer>,
}));

vi.mock("@/components/language-switcher", () => ({
	LanguageSwitcher: () => <button type="button">Language</button>,
}));

vi.mock("@/components/font-size-toggle", () => ({
	FontSizeToggle: () => <button type="button">Font size</button>,
}));

vi.mock("@/components/theme-toggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

describe("OnboardingLayout", () => {
	it("keeps random content in an async child behind neutral shell geometry", () => {
		const layout = OnboardingLayout({
			children: <div>private onboarding child</div>,
		});

		expect(layout).not.toBeInstanceOf(Promise);
		expect(isValidElement(layout)).toBe(true);
		if (!isValidElement<{ fallback: React.ReactNode }>(layout)) {
			throw new Error("Expected OnboardingLayout to return Suspense");
		}
		expect(layout.type).toBe(Suspense);

		render(layout.props.fallback);
		expect(
			screen.getByRole("status", { name: "Loading onboarding" }),
		).toBeTruthy();
		expect(screen.queryByText("private onboarding child")).toBeNull();

		const contentStart = source.indexOf(
			"async function OnboardingLayoutContent",
		);
		expect(contentStart).toBeGreaterThan(-1);
		expect(source.indexOf("await connection()", contentStart)).toBeGreaterThan(
			contentStart,
		);
		expect(source.slice(0, contentStart)).not.toContain("connection()");
	});

	it("uses the auth-style full-screen glass shell", async () => {
		const layout = OnboardingLayout({
			children: <div data-slot="card">Onboarding content</div>,
		});
		if (!isValidElement(layout) || !isValidElement(layout.props.children)) {
			throw new Error("Expected onboarding content boundary");
		}
		const contentElement = layout.props.children as React.ReactElement<
			{ children: React.ReactNode },
			(props: { children: React.ReactNode }) => Promise<React.ReactNode>
		>;
		render(await contentElement.type(contentElement.props));

		const content = screen.getByText("Onboarding content");
		const main = content.closest("main");
		const background = screen.getByTestId("onboarding-background");
		const footer = screen.getByText("Info footer");

		expect(background.className).toContain("absolute");
		expect(background.className).toContain("inset-0");
		expect(background.className).toContain("object-cover");
		expect(main?.className).toContain("onboarding-glass-scope");
		expect(main?.className).toContain("flex-1");
		const controls = screen
			.getByRole("button", { name: "Theme" })
			.closest("div");
		expect(controls?.className).toContain("auth-shell-controls");
		expect(controls?.className).toContain("auth-shell-controls-readable");
		expect(controls?.className).toContain(
			"[&_[data-slot=dropdown-menu-trigger]]:!bg-slate-950/85",
		);
		expect(controls?.className).toContain(
			"[&_[data-slot=select-trigger]]:!bg-slate-950/85",
		);
		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
		expect(footer.closest("div")?.className).toContain("drop-shadow-sm");
	});
});
