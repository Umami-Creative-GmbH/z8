/* @vitest-environment jsdom */

import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppLocaleProvider } from "@/components/providers/app-locale-provider";
import { render } from "@/test/render-with-translations";
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

		render(
			<DatePicker
				value="2024-05-01"
				onBlur={handleBlur}
				onChange={handleChange}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /2024/i }));
		fireEvent.click(screen.getByRole("button", { name: /clear date/i }));

		expect(handleChange).toHaveBeenCalledWith("");
		expect(handleBlur).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: /clear date/i })).toBeNull();
	});

	it("shows the value and calendar in English on /en, whatever the browser language", () => {
		render(<DatePicker value="2026-10-23" onChange={vi.fn()} />, {
			wrapper: ({ children }) => <AppLocaleProvider locale="en">{children}</AppLocaleProvider>,
		});

		fireEvent.click(screen.getByRole("button", { name: "Oct 23, 2026" }));

		expect(screen.getByText("October 2026")).toBeTruthy();
		expect(screen.getByText("Tu")).toBeTruthy();
	});

	it("shows the value and calendar in German on /de", () => {
		render(<DatePicker value="2026-10-23" onChange={vi.fn()} />, {
			wrapper: ({ children }) => <AppLocaleProvider locale="de">{children}</AppLocaleProvider>,
		});

		fireEvent.click(screen.getByRole("button", { name: "23. Okt. 2026" }));

		expect(screen.getByText("Oktober 2026")).toBeTruthy();
		expect(screen.getByText("Di")).toBeTruthy();
	});

	it("emits the picked civil date as YYYY-MM-DD", () => {
		const handleChange = vi.fn();
		render(<DatePicker value="2026-10-23" onChange={handleChange} />);

		fireEvent.click(screen.getByRole("button", { name: /2026/ }));
		fireEvent.click(screen.getByRole("button", { name: /October 5th, 2026/ }));

		expect(handleChange).toHaveBeenCalledWith("2026-10-05");
	});

	it("hides the clear button when the date is required", () => {
		render(<DatePicker required value="2024-05-01" onChange={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /2024/i }));

		expect(screen.queryByRole("button", { name: /clear date/i })).toBeNull();
	});
});
