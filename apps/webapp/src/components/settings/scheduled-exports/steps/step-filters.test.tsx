/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledExportForm } from "../scheduled-export-dialog";
import { type FilterOptions, StepFilters } from "./step-filters";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
// The picker as the step hands it over: which people it offers and which are chosen.
vi.mock("@/components/employee-select", async (original) => ({
	...(await original<typeof import("@/components/employee-select")>()),
	EmployeeMultiSelect: ({ employees, value }: { employees: { id: string }[]; value: string[] }) => (
		<>
			<output aria-label="offered employees">{employees.map((row) => row.id).join(",")}</output>
			<output aria-label="chosen employees">{value.join(",")}</output>
		</>
	),
}));
vi.mock("../filter-selector", () => ({ FilterSelector: () => null }));

afterEach(cleanup);

function formWith(filters: { employeeIds?: string[] }) {
	const Field = ({ name, children }: { name: string; children: (field: unknown) => ReactNode }) =>
		children({
			state: { value: name === "filters" ? filters : "previous_month" },
			handleChange: vi.fn(),
		});
	return { Field } as unknown as ScheduledExportForm;
}

const options = (employees: FilterOptions["employees"]): FilterOptions => ({
	employees,
	teams: [],
	projects: [],
});

describe("scheduled export filters: All | Employees | External Contractors (#1995)", () => {
	const people: FilterOptions["employees"] = [
		{ id: "ada", firstName: "Ada", lastName: "Lovelace", engagementKind: "employee" },
		{ id: "grace", firstName: "Grace", lastName: "Hopper", engagementKind: "contractor" },
		{ id: "alan", firstName: "Alan", lastName: "Turing", engagementKind: "employee" },
	];

	it("narrows the employee picker by engagement kind, keeping people already chosen", () => {
		render(
			<StepFilters form={formWith({ employeeIds: ["alan"] })} filterOptions={options(people)} />,
		);
		const offered = () => screen.getByRole("status", { name: "offered employees" }).textContent;

		expect(offered()).toBe("ada,grace,alan");

		fireEvent.click(screen.getByRole("radio", { name: "External Contractors" }));
		expect(offered()).toBe("grace,alan");
		expect(screen.getByRole("status", { name: "chosen employees" }).textContent).toBe("alan");

		fireEvent.click(screen.getByRole("radio", { name: "Employees" }));
		expect(offered()).toBe("ada,alan");
	});

	it("says the engagement filter only narrows the picker, not what the export includes", () => {
		render(<StepFilters form={formWith({})} filterOptions={options(people)} />);
		const hint =
			"This only narrows the list of people to pick from. With nobody selected, the export includes everyone.";

		expect(screen.queryByText(hint)).toBeNull();
		fireEvent.click(screen.getByRole("radio", { name: "Employees" }));
		expect(screen.getByText(hint)).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "All" }));
		expect(screen.queryByText(hint)).toBeNull();
	});

	it("offers no engagement filter while the organization has no External Contractors", () => {
		render(
			<StepFilters
				form={formWith({})}
				filterOptions={options(people.filter((row) => row.engagementKind === "employee"))}
			/>,
		);

		expect(screen.queryByRole("radiogroup", { name: "Engagement" })).toBeNull();
	});
});
