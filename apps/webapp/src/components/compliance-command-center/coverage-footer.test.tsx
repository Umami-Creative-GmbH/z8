/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CoverageFooter } from "./coverage-footer";

describe("CoverageFooter", () => {
	it("renders the refreshed timestamp in a deterministic UTC format", () => {
		render(
			<CoverageFooter
				notes={["Access controls only summarize logged audit events."]}
				refreshedAt="2026-04-11T10:00:00.000Z"
			/>,
		);

		const timestamp = screen.getByText("2026-04-11 10:00 UTC");

		expect(timestamp).toBeTruthy();
		expect(timestamp.getAttribute("datetime")).toBe("2026-04-11T10:00:00.000Z");
	});
});
