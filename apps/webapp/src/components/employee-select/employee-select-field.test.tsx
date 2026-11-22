// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeeMultiSelect, EmployeeSingleSelect } from "./employee-select-field";
import { toSelectableEmployee } from "./to-selectable-employee";
import type { SelectableEmployee } from "./types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) => {
			let translated = fallback;
			for (const [key, value] of Object.entries(params ?? {})) {
				translated = translated.replace(`{${key}}`, String(value));
			}
			return translated;
		},
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

function makeEmployee(id: string, name: string): SelectableEmployee {
	return {
		id,
		userId: id,
		firstName: null,
		lastName: null,
		pronouns: null,
		position: null,
		role: "employee",
		isActive: true,
		teamId: null,
		user: {
			id,
			name,
			email: `${id}@example.com`,
			image: null,
		},
		team: null,
	};
}

function ControlledEmployeeMultiSelect() {
	const [value, setValue] = useState<string[]>([]);

	return (
		<div>
			<EmployeeMultiSelect
				label="Employees"
				value={value}
				onChange={setValue}
				employees={[
					makeEmployee("employee-a", "Ada Lovelace"),
					makeEmployee("employee-b", "Grace Hopper"),
				]}
			/>
			<output aria-label="selected employee ids">{value.join(",")}</output>
		</div>
	);
}

describe("EmployeeMultiSelect", () => {
	beforeEach(() => {
		globalThis.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	});

	it("applies every pending employee selected before confirm", async () => {
		const user = userEvent.setup();
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});

		render(
			<QueryClientProvider client={queryClient}>
				<ControlledEmployeeMultiSelect />
			</QueryClientProvider>,
		);

		expect(screen.getByLabelText("Employees")).toBe(screen.getByRole("combobox"));
		await user.click(screen.getByRole("combobox"));
		await user.click(screen.getByRole("option", { name: /Ada Lovelace/i }));
		await user.click(screen.getByRole("option", { name: /Grace Hopper/i }));
		await user.click(screen.getByRole("button", { name: "Confirm (2)" }));

		await waitFor(() =>
			expect(screen.getByLabelText("selected employee ids").textContent).toBe(
				"employee-a,employee-b",
			),
		);
	});

	it("labels a former employee in the list and in the selection (#1438)", async () => {
		const user = userEvent.setup();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const former = { ...makeEmployee("employee-f", "Fern Former"), isActive: false, isFormer: true };

		render(
			<QueryClientProvider client={queryClient}>
				<EmployeeMultiSelect
					label="Employees"
					value={["employee-f"]}
					onChange={() => {}}
					employees={[makeEmployee("employee-a", "Ada Lovelace"), former]}
				/>
			</QueryClientProvider>,
		);

		// The chip of the selected former employee carries the label.
		expect(screen.getByText("Former")).toBeTruthy();
		await user.click(screen.getByRole("combobox"));
		const option = screen.getByRole("option", { name: /Fern Former/i });
		expect(option.textContent).toContain("Former");
		expect(screen.getByRole("option", { name: /Ada Lovelace/i }).textContent).not.toContain(
			"Former",
		);
	});

	it("keeps the selection panel mounted across open state changes so it can animate", () => {
		const source = readFileSync(join(__dirname, "employee-select-field.tsx"), "utf8");

		expect(source).not.toContain('`${modalOpen ? "open" : "closed"}');
		expect(source).not.toContain("modalOpen ?");
	});

	it("excludes excludeIds and matches searchKeywords in pre-filtered mode", async () => {
		const user = userEvent.setup();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

		render(
			<QueryClientProvider client={queryClient}>
				<EmployeeSingleSelect
					label="Employee"
					value={null}
					onChange={() => {}}
					excludeIds={["employee-a"]}
					employees={[
						toSelectableEmployee({ id: "employee-a", name: "Ada Lovelace", employeeNumber: "P-100" }),
						toSelectableEmployee({ id: "employee-b", name: "Grace Hopper", employeeNumber: "P-200" }),
					]}
				/>
			</QueryClientProvider>,
		);

		await user.click(screen.getByRole("combobox", { name: "Employee" }));
		expect(screen.queryByRole("option", { name: /Ada Lovelace/i })).toBeNull();
		expect(screen.getByRole("option", { name: /Grace Hopper/i })).toBeTruthy();

		await user.type(screen.getByPlaceholderText(/Search/i), "P-200");
		expect(screen.getByRole("option", { name: /Grace Hopper/i })).toBeTruthy();
	});

	it("offers a clear option and pins suggested employees in single-select mode", async () => {
		const user = userEvent.setup();
		const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		const onChange = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<EmployeeSingleSelect
					aria-label="Filter employee"
					value="employee-b"
					onChange={onChange}
					allowClear
					clearLabel="All employees"
					pinnedIds={["employee-b"]}
					employees={[
						makeEmployee("employee-a", "Ada Lovelace"),
						makeEmployee("employee-b", "Grace Hopper"),
					]}
				/>
			</QueryClientProvider>,
		);

		await user.click(screen.getByRole("combobox", { name: "Filter employee" }));
		const options = screen.getAllByRole("option");
		expect(options[0].textContent).toContain("All employees");
		expect(options[1].textContent).toContain("Grace Hopper");
		expect(options[2].textContent).toContain("Ada Lovelace");

		await user.click(screen.getByRole("option", { name: "All employees" }));
		expect(onChange).toHaveBeenCalledWith(null);
	});
});
