/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DatePicker } from "./date-picker";

describe("DatePicker", () => {
	it("renders the default placeholder when empty", () => {
		render(<DatePicker value="" onChange={vi.fn()} />);

		expect(screen.getByRole("button", { name: /pick a date/i })).toBeTruthy();
	});

	it("renders an existing date as a readable local date", () => {
		render(<DatePicker value="2024-05-01" onChange={vi.fn()} />);

		expect(screen.getByRole("button", { name: /2024/i })).toBeTruthy();
	});

	it("emits an empty string without synthesizing blur when clearing an optional date", () => {
		const handleChange = vi.fn();
		const handleBlur = vi.fn();

		render(<DatePicker value="2024-05-01" onBlur={handleBlur} onChange={handleChange} />);

		fireEvent.click(screen.getByRole("button", { name: /2024/i }));
		fireEvent.click(screen.getByRole("button", { name: /clear date/i }));

		expect(handleChange).toHaveBeenCalledWith("");
		expect(handleBlur).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: /clear date/i })).toBeNull();
	});

	it("hides the clear button when the date is required", () => {
		render(<DatePicker required value="2024-05-01" onChange={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /2024/i }));

		expect(screen.queryByRole("button", { name: /clear date/i })).toBeNull();
	});
});
