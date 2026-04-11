/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useLocale: () => "en-US",
}));

describe("ExportOperationsDateTime", () => {
	it("renders a truthful timestamp fallback before mount", async () => {
		const { ExportOperationsDateTime } = await import("./export-operations-date-time");
		const markup = renderToString(
			<ExportOperationsDateTime value={new Date("2026-04-10T09:00:00.000Z")} emptyLabel="Never" />,
		);

		expect(markup).not.toContain("Never");
		expect(markup).toContain("2026");
	});

	it("keeps the empty label for missing timestamps", async () => {
		const { ExportOperationsDateTime } = await import("./export-operations-date-time");

		render(<ExportOperationsDateTime value={null} emptyLabel="Never" />);

		expect(screen.getByText("Never")).toBeTruthy();
	});
});
