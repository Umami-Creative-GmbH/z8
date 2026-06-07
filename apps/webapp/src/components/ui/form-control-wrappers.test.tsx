/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";
import { Switch } from "./switch";
import { Tabs, TabsList, TabsTrigger } from "./tabs";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

beforeAll(() => {
	global.ResizeObserver = class ResizeObserver {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
});

describe("form control wrappers", () => {
	it("uses Base UI checked attributes while preserving checkbox form integration", () => {
		const { container } = render(
			<form>
				<Checkbox checked name="acceptTerms" value="yes" onCheckedChange={() => {}} />
			</form>,
		);

		const checkbox = screen.getByRole("checkbox");
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		expect(checkbox.hasAttribute("data-checked")).toBe(true);
		expect(checkbox.hasAttribute("data-state")).toBe(false);
		expect(container.querySelector('[data-slot="checkbox-indicator"]')).toBeTruthy();
		expect(container.querySelector<HTMLInputElement>('input[name="acceptTerms"]')?.value).toBe(
			"yes",
		);
	});

	it("preserves indeterminate checkbox semantics", () => {
		render(<Checkbox checked="indeterminate" aria-label="Select all employees" />);

		const checkbox = screen.getByRole("checkbox");
		expect(checkbox.getAttribute("aria-checked")).toBe("mixed");
		expect(checkbox.hasAttribute("data-indeterminate")).toBe(true);
		expect(checkbox.hasAttribute("data-state")).toBe(false);
	});

	it("puts explicit switch ids on the role-bearing control", () => {
		const { container } = render(
			<Switch id="availability-switch" checked onCheckedChange={() => {}} />,
		);

		const control = screen.getByRole("switch");

		expect(control.id).toBe("availability-switch");
		expect(container.querySelectorAll("#availability-switch")).toHaveLength(1);
	});

	it("renders Switch as a non-submit control inside forms by default", () => {
		render(
			<form>
				<Switch aria-label="Available" checked onCheckedChange={() => {}} />
			</form>,
		);

		expect(screen.getByRole("switch", { name: "Available" }).getAttribute("type")).toBe("button");
	});

	it("keeps an explicit default button type in the Switch render adapter", () => {
		const source = readFileSync(join(process.cwd(), "src/components/ui/switch.tsx"), "utf8");

		expect(source).toContain('type="button"');
	});

	it("renders TabsTrigger asChild anchors without native button assumptions", () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			render(
				<Tabs defaultValue="overview">
					<TabsList>
						<TabsTrigger value="overview" asChild>
							<a href="/analytics">Overview</a>
						</TabsTrigger>
					</TabsList>
				</Tabs>,
			);

			const tab = screen.getByRole("tab", { name: "Overview" });
			expect(tab.getAttribute("href")).toBe("/analytics");
			expect(tab.getAttribute("data-slot")).toBe("tabs-trigger");
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});

	it("activates TabsTrigger on primary mouseDown", () => {
		const handleValueChange = vi.fn();

		render(
			<Tabs defaultValue="day" onValueChange={handleValueChange}>
				<TabsList>
					<TabsTrigger value="day">Day</TabsTrigger>
					<TabsTrigger value="week">Week</TabsTrigger>
				</TabsList>
			</Tabs>,
		);

		fireEvent.mouseDown(screen.getByRole("tab", { name: "Week" }), {
			button: 0,
			ctrlKey: false,
		});

		expect(handleValueChange).toHaveBeenCalledWith("week", expect.anything());
	});

	it("uses complete radio semantics for single-value ToggleGroup", () => {
		render(
			<ToggleGroup type="single" defaultValue="day" aria-label="Payroll cadence">
				<ToggleGroupItem value="day">Day</ToggleGroupItem>
				<ToggleGroupItem value="week">Week</ToggleGroupItem>
			</ToggleGroup>,
		);

		const group = screen.getByRole("radiogroup", { name: "Payroll cadence" });
		expect(group.getAttribute("data-slot")).toBe("toggle-group");
		expect(screen.getByRole("radio", { name: "Day" }).getAttribute("aria-checked")).toBe("true");
		expect(screen.getByRole("radio", { name: "Week" }).getAttribute("aria-checked")).toBe("false");
	});

	it("renders ToggleGroup buttons as non-submit controls inside forms", () => {
		const handleSubmit = vi.fn();

		render(
			<form
				onSubmit={(event) => {
					event.preventDefault();
					handleSubmit();
				}}
			>
				<ToggleGroup type="single" defaultValue="day" aria-label="Payroll cadence">
					<ToggleGroupItem value="day">Day</ToggleGroupItem>
					<ToggleGroupItem value="week">Week</ToggleGroupItem>
				</ToggleGroup>
				<ToggleGroup type="multiple" defaultValue={["admin"]} aria-label="Permissions">
					<ToggleGroupItem value="admin">Admin</ToggleGroupItem>
					<ToggleGroupItem value="billing">Billing</ToggleGroupItem>
				</ToggleGroup>
			</form>,
		);

		const week = screen.getByRole("radio", { name: "Week" });
		const billing = screen.getByRole("button", { name: "Billing" });

		expect(week.getAttribute("type")).toBe("button");
		expect(billing.getAttribute("type")).toBe("button");

		fireEvent.click(week);
		fireEvent.click(billing);

		expect(handleSubmit).not.toHaveBeenCalled();
	});

	it("keeps explicit button types in the ToggleGroup render adapter", () => {
		const source = readFileSync(join(process.cwd(), "src/components/ui/toggle-group.tsx"), "utf8");

		expect(source).toContain('<button {...buttonProps} type="button" />');
		expect(source).toContain('role="radio" type="button"');
	});
});
