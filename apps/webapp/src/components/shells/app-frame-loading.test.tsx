/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppFrameLoading } from "./app-frame-loading";
import { AuthContentLoading } from "./auth-content-loading";
import { SettingsContentLoading } from "./settings-content-loading";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) => {
			const translations: Record<string, string> = {
				"common:loading.application": "Anwendung wird geladen",
				"common:loading.authentication": "Anmeldung wird geladen",
				"common:loading.chart": "Diagramm wird geladen",
				"common:loading.settings": "Einstellungen werden geladen",
			};
			return translations[key] ?? fallback;
		},
	}),
}));

describe("AppFrameLoading", () => {
	it("renders a neutral authenticated frame without tenant data", () => {
		const { container } = render(<AppFrameLoading />);

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Anwendung wird geladen")).toBeTruthy();
		expect(screen.getByTestId("app-sidebar-loading")).toBeTruthy();
		expect(screen.getByTestId("app-header-loading")).toBeTruthy();
		expect(container.textContent).toBe("Anwendung wird geladen");
	});

	it("does not import sensitive application modules", () => {
		const forbiddenImport =
			/from\s+["'][^"']*(?:auth|db|organization|billing|notification|session)/i;
		const shellModules = [
			"app-frame-loading.tsx",
			"auth-content-loading.tsx",
			"settings-content-loading.tsx",
		];

		for (const fileName of shellModules) {
			const source = readFileSync(new URL(fileName, import.meta.url), "utf8");
			expect(source, fileName).not.toMatch(forbiddenImport);
		}
	});
});

describe("AuthContentLoading", () => {
	it("renders a named busy region with generic auth card structure", () => {
		const { container } = render(<AuthContentLoading />);

		expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByText("Anmeldung wird geladen")).toBeTruthy();
		expect(container.querySelector('[data-slot="card"]')).toBeTruthy();
		expect(container.textContent).toBe("Anmeldung wird geladen");
	});
});

describe("SettingsContentLoading", () => {
	it("immediately renders a localized busy region with generic settings structure", () => {
		const { container } = render(<SettingsContentLoading />);

		expect(
			screen
				.getByRole("status", { name: "Einstellungen werden geladen" })
				.getAttribute("aria-busy"),
		).toBe("true");
		expect(
			screen.queryByRole("status", { name: "Loading settings" }),
		).toBeNull();
		expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(
			5,
		);
		expect(container.textContent).toBe("");
	});

	it("defines localized loading labels in every common catalog", () => {
		const keys = [
			"application",
			"authentication",
			"calendar",
			"chart",
			"licenses",
			"platformAnalytics",
			"settings",
			"setup",
			"teamAbsences",
			"workerQueue",
		];
		const english = JSON.parse(readFileSync("messages/common/en.json", "utf8"));
		for (const locale of [
			"en",
			"de",
			"el",
			"es",
			"fr",
			"gsw",
			"it",
			"pl",
			"pt",
			"tr",
		]) {
			const catalog = JSON.parse(
				readFileSync(`messages/common/${locale}.json`, "utf8"),
			);
			expect(Object.keys(catalog.loading).sort(), locale).toEqual(
				[...keys].sort(),
			);
			for (const key of keys) {
				expect(catalog.loading[key], `${locale}: ${key}`).toEqual(
					expect.any(String),
				);
				expect(catalog.loading[key].trim(), `${locale}: ${key}`).not.toBe("");
				if (locale !== "en")
					expect(catalog.loading[key], `${locale}: ${key}`).not.toBe(
						english.loading[key],
					);
			}
		}
	});
});
