/* @vitest-environment jsdom */

import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "./theme-provider";

function Consumer() {
	const { resolvedTheme, setTheme, theme } = useTheme();

	return (
		<div>
			<p>Theme: {theme}</p>
			<p>Resolved: {resolvedTheme}</p>
			<button type="button" onClick={() => setTheme("dark")}>
				Set Dark
			</button>
		</div>
	);
}

beforeEach(() => {
	localStorage.clear();
	document.documentElement.className = "";
	document.documentElement.style.colorScheme = "";
	Object.defineProperty(window, "matchMedia", {
		configurable: true,
		value: vi.fn(() => ({
			matches: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		})),
	});
});

describe("ThemeProvider", () => {
	it("does not render script tags during client navigation", () => {
		const { container } = render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(container.querySelector("script")).toBeNull();
	});

	it("loads the stored theme and updates html when changed", async () => {
		localStorage.setItem("theme", "light");

		render(
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<Consumer />
			</ThemeProvider>,
		);

		expect(await screen.findByText("Theme: light")).toBeTruthy();
		expect(screen.getByText("Resolved: light")).toBeTruthy();
		expect(document.documentElement.classList.contains("light")).toBe(true);

		act(() => {
			screen.getByRole("button", { name: "Set Dark" }).click();
		});

		expect(screen.getByText("Theme: dark")).toBeTruthy();
		expect(screen.getByText("Resolved: dark")).toBeTruthy();
		expect(localStorage.getItem("theme")).toBe("dark");
		expect(document.documentElement.classList.contains("dark")).toBe(true);
		expect(document.documentElement.classList.contains("light")).toBe(false);
	});
});
