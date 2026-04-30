/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VariablePalette } from "./variable-palette";

describe("VariablePalette", () => {
	it("renders variables as a single-column list", () => {
		render(
			<VariablePalette
				variables={[
					{
						name: "userName",
						label: "User name",
						description: "Name of the user.",
						example: "Alex Morgan",
					},
				]}
				onInsert={vi.fn()}
			/>,
		);

		const list = screen.getByTestId("email-template-variable-list");

		expect(list.className).toContain("grid");
		expect(list.className).not.toContain("sm:grid-cols-2");
	});

	it("keeps long variable values inside the palette", () => {
		render(
			<VariablePalette
				variables={[
					{
						name: "verificationUrl",
						label: "Verification URL",
						description: "Verification link.",
						example: "https://app.z8-time.app/verify-email?token=preview-token-with-a-long-value",
					},
				]}
				onInsert={vi.fn()}
			/>,
		);

		const button = screen.getByRole("button", { name: "Insert Verification URL" });
		const token = screen.getByText("{{verificationUrl}}");
		const example = screen.getByText(
			"https://app.z8-time.app/verify-email?token=preview-token-with-a-long-value",
		);

		expect(button.className).toContain("w-full");
		expect(button.className).toContain("min-w-0");
		expect(token.className).toContain("break-all");
		expect(example.className).toContain("break-all");
	});
});
