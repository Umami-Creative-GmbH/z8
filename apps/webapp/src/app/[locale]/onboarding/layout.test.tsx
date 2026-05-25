/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OnboardingLayout from "./layout";

vi.mock("next/image", () => ({
	default: ({ alt, className }: { alt: string; className?: string }) => (
		<img alt={alt} className={className} data-testid="onboarding-background" />
	),
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
	it("uses the auth-style full-screen glass shell", () => {
		render(
			<OnboardingLayout>
				<div data-slot="card">Onboarding content</div>
			</OnboardingLayout>,
		);

		const content = screen.getByText("Onboarding content");
		const main = content.closest("main");
		const background = screen.getByTestId("onboarding-background");
		const footer = screen.getByText("Info footer");

		expect(background.className).toContain("absolute");
		expect(background.className).toContain("inset-0");
		expect(background.className).toContain("object-cover");
		expect(main?.className).toContain("onboarding-glass-scope");
		expect(main?.className).toContain("flex-1");
		expect(screen.getByRole("button", { name: "Theme" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
		expect(footer.closest("div")?.className).toContain("drop-shadow-sm");
	});
});
