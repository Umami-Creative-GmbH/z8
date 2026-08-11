/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalizedLoadingLabel } from "./localized-loading-label";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) =>
			key === "common:loading.calendar" ? "Kalender wird geladen" : fallback,
	}),
}));

describe("LocalizedLoadingLabel", () => {
	it("renders translated screen-reader-only text", () => {
		render(
			<LocalizedLoadingLabel
				translationKey="common:loading.calendar"
				fallback="Loading calendar"
			/>,
		);

		const label = screen.getByText("Kalender wird geladen");
		expect(label.className).toContain("sr-only");
	});
});
