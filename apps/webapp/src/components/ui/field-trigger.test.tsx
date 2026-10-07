/* @vitest-environment jsdom */

import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeSelectTrigger } from "@/components/employee-select/employee-select-trigger";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { cn } from "@/lib/utils";
import { render } from "@/test/render-with-translations";
import { buttonVariants } from "./button-variants";
import { DatePicker } from "./date-picker";
import { fieldSurfaceClassName } from "./field-trigger";
import { Input } from "./input";
import { SearchableSelect } from "./searchable-select";
import { Select, SelectItem, SelectTrigger, SelectValue } from "./select";

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span />,
}));

const surfaceClasses = fieldSurfaceClassName.split(" ");
const outlineOnlyClasses = ["bg-background", "hover:bg-accent", "hover:text-accent-foreground"];

function expectFieldSurface(element: HTMLElement) {
	const classes = element.className.split(" ");

	for (const surfaceClass of surfaceClasses) {
		expect(classes).toContain(surfaceClass);
	}
	for (const outlineClass of outlineOnlyClasses) {
		expect(classes).not.toContain(outlineClass);
	}
}

describe("field trigger look", () => {
	it("gives the field button variant the select trigger's padding at every size", () => {
		expect(buttonVariants({ variant: "field" })).toContain("h-9");
		expect(buttonVariants({ variant: "field", size: "sm" })).toContain("h-8");
		for (const size of ["default", "sm"] as const) {
			// `Button` merges the variant classes the same way.
			const classes = cn(buttonVariants({ variant: "field", size })).split(" ");
			expect(classes).toContain("px-3");
			expect(classes).not.toContain("px-4");
			expect(classes).not.toContain("has-[>svg]:px-2.5");
		}
	});

	it("is shared by Input, SelectTrigger and every popover picker trigger", () => {
		render(
			<>
				<Input aria-label="Text" />
				<Select defaultValue="a">
					<SelectTrigger aria-label="Select">
						<SelectValue />
					</SelectTrigger>
					<SelectItem value="a">A</SelectItem>
				</Select>
				<DatePicker aria-label="Date" onChange={vi.fn()} value="" />
				<TimezonePicker onChange={vi.fn()} value="Europe/Berlin" />
				<SearchableSelect
					emptyText="None"
					onValueChange={vi.fn()}
					options={[]}
					placeholder="Pick a country"
					searchPlaceholder="Search"
					value=""
				/>
				<EmployeeSelectTrigger mode="single" onClick={vi.fn()} selectedEmployees={[]} />
			</>,
		);

		expectFieldSurface(screen.getByRole("textbox", { name: "Text" }));
		expectFieldSurface(screen.getByRole("combobox", { name: "Select" }));
		expectFieldSurface(screen.getByRole("button", { name: /date/i }));
		expectFieldSurface(screen.getByText(/Berlin/).closest("button") as HTMLElement);
		expectFieldSurface(screen.getByText("Pick a country").closest("button") as HTMLElement);
		expectFieldSurface(screen.getByText("Select employee").closest("button") as HTMLElement);
	});

	it("marks empty picker triggers as placeholders", () => {
		render(
			<>
				<DatePicker aria-label="Date" onChange={vi.fn()} value="" />
				<SearchableSelect
					emptyText="None"
					onValueChange={vi.fn()}
					options={[]}
					placeholder="Pick a country"
					searchPlaceholder="Search"
					value=""
				/>
				<EmployeeSelectTrigger mode="single" onClick={vi.fn()} selectedEmployees={[]} />
			</>,
		);

		expect(screen.getByRole("button", { name: /date/i }).hasAttribute("data-placeholder")).toBe(
			true,
		);
		expect(
			screen.getByText("Pick a country").closest("button")?.hasAttribute("data-placeholder"),
		).toBe(true);
		expect(
			screen.getByText("Select employee").closest("button")?.hasAttribute("data-placeholder"),
		).toBe(true);
	});

	it("marks a picker with a value as not a placeholder", () => {
		render(<DatePicker aria-label="Date" onChange={vi.fn()} value="2026-10-07" />);

		expect(screen.getByRole("button", { name: /date/i }).hasAttribute("data-placeholder")).toBe(
			false,
		);
	});

	it("lets the searchable pickers show the shared invalid state", () => {
		render(
			<>
				<TimezonePicker aria-invalid onChange={vi.fn()} value="Europe/Berlin" />
				<SearchableSelect
					aria-invalid
					emptyText="None"
					onValueChange={vi.fn()}
					options={[]}
					placeholder="Pick a country"
					searchPlaceholder="Search"
					value=""
				/>
			</>,
		);

		for (const trigger of screen.getAllByRole("combobox")) {
			expect(trigger.getAttribute("aria-invalid")).toBe("true");
		}
	});

	it("shows an employee error through the shared invalid state", () => {
		render(
			<EmployeeSelectTrigger
				error="Required"
				mode="single"
				onClick={vi.fn()}
				selectedEmployees={[]}
			/>,
		);

		const trigger = screen.getByText("Select employee").closest("button") as HTMLElement;
		expect(trigger.getAttribute("aria-invalid")).toBe("true");
		expectFieldSurface(trigger);
	});
});
