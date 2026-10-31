/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "de" }));
vi.mock("@/components/theme-provider", () => ({ useTheme: () => ({ theme: "dark" }) }));
vi.mock("@/lib/language-config", () => ({
	LANGUAGE_CONFIG: { de: { name: "Deutsch", Flag: () => <svg data-testid="flag" /> } },
}));
vi.mock("./theme-toggle", () => ({
	ThemeToggle: ({ defaultOpen }: { defaultOpen?: boolean }) => (
		<div data-testid="theme-menu">open={String(defaultOpen)}</div>
	),
}));
vi.mock("./font-size-toggle", () => ({
	FontSizeToggle: ({ defaultOpen }: { defaultOpen?: boolean }) => (
		<div data-testid="font-menu">open={String(defaultOpen)}</div>
	),
}));
vi.mock("./language-switcher", () => ({
	LanguageSwitcher: ({ defaultOpen }: { defaultOpen?: boolean }) => (
		<div data-testid="language-select">open={String(defaultOpen)}</div>
	),
}));

import { AuthShellControls } from "./auth-shell-controls";

describe("AuthShellControls", () => {
	it("renders look-alike triggers with the header's trigger slots", () => {
		render(<AuthShellControls />);

		const theme = screen.getByRole("button", { name: "Toggle theme" });
		const font = screen.getByRole("button", { name: "Font size" });
		const language = screen.getByRole("button", { name: "Select language" });
		expect(theme.dataset.slot).toBe("dropdown-menu-trigger");
		expect(font.dataset.slot).toBe("dropdown-menu-trigger");
		expect(language.dataset.slot).toBe("select-trigger");
		expect(language.textContent).toContain("Deutsch");
		expect(screen.getByTestId("flag")).toBeTruthy();
		expect(screen.queryByTestId("theme-menu")).toBeNull();
	});

	it("swaps a trigger for its real control, already open, on click", async () => {
		render(<AuthShellControls />);

		fireEvent.pointerEnter(screen.getByRole("button", { name: "Font size" }));
		expect(screen.queryByTestId("font-menu")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Select language" }));
		expect((await screen.findByTestId("language-select")).textContent).toBe("open=true");
		expect(screen.queryByRole("button", { name: "Select language" })).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Toggle theme" }));
		expect((await screen.findByTestId("theme-menu")).textContent).toBe("open=true");
		expect(screen.getByRole("button", { name: "Font size" })).toBeTruthy();
	});
});
