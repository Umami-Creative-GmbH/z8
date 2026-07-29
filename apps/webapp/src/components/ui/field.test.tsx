/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FieldError } from "./field";

describe("FieldError", () => {
	it("renders nothing when errors contain no nonempty messages", () => {
		const { container } = render(
			<FieldError errors={[undefined, {}, { message: "" }, { message: "" }]} />,
		);

		expect(container.childElementCount).toBe(0);
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.queryByRole("list")).toBeNull();
	});

	it("renders deduplicated messages in their current order", () => {
		const { rerender } = render(
			<FieldError
				errors={[
					{ message: "First" },
					{ message: "Second" },
					{ message: "First" },
				]}
			/>,
		);

		expect(
			screen.getAllByRole("listitem").map((item) => item.textContent),
		).toEqual(["First", "Second"]);

		rerender(
			<FieldError errors={[{ message: "Second" }, { message: "First" }]} />,
		);
		expect(
			screen.getAllByRole("listitem").map((item) => item.textContent),
		).toEqual(["Second", "First"]);
	});
});
