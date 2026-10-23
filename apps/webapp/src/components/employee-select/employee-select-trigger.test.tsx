/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeChips, EmployeeSelectTrigger } from "./employee-select-trigger";
import type { SelectableEmployee } from "./types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: ({
		clockStatus,
		name,
	}: {
		clockStatus?: "clocked-in" | "clocked-out" | "unknown";
		name?: string | null;
	}) => <span data-avatar-name={name ?? ""} data-clock-status={clockStatus ?? "unknown"} />,
}));

const employee: SelectableEmployee = {
	id: "emp_1",
	userId: "user_1",
	firstName: "Ada",
	lastName: "Lovelace",
	pronouns: "she/her",
	position: "Engineer",
	role: "employee",
	isActive: true,
	teamId: null,
	user: {
		id: "user_1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	},
	team: null,
};

describe("EmployeeSelectTrigger", () => {
	it("shows pronouns for a selected single employee", () => {
		render(
			<EmployeeSelectTrigger
				mode="single"
				selectedEmployees={[{ ...employee, clockStatus: "clocked-in" }]}
				onClick={vi.fn()}
			/>,
		);

		expect(screen.getByText("Ada Lovelace (she/her)")).toBeTruthy();
		expect(
			screen.getByText("", { selector: '[data-avatar-name="Ada Lovelace (she/her)"]' }),
		).toBeTruthy();
		expect(screen.getByText("", { selector: '[data-clock-status="clocked-in"]' })).toBeTruthy();
	});

	it("says since when a selected former employee is former (#1439)", () => {
		render(
			<EmployeeSelectTrigger
				mode="single"
				selectedEmployees={[{ ...employee, isActive: false, formerSince: "2026-10-12" }]}
				onClick={vi.fn()}
			/>,
		);

		expect(screen.getByText("Former since Oct 12, 2026")).toBeTruthy();
	});

	it("keeps the plain label when the source doesn't say when they left", () => {
		render(
			<EmployeeSelectTrigger
				mode="single"
				selectedEmployees={[{ ...employee, isActive: false }]}
				onClick={vi.fn()}
			/>,
		);

		expect(screen.getByText("Former")).toBeTruthy();
	});

	it("says in a chip when a former employee's date isn't recorded", () => {
		render(
			<EmployeeChips
				employees={[{ ...employee, isActive: false, isFormer: true, formerSince: null }]}
				onRemove={vi.fn()}
			/>,
		);

		expect(screen.getByText("Former · date not recorded")).toBeTruthy();
	});

	it("shows pronouns in selected employee chips", () => {
		render(<EmployeeChips employees={[employee]} onRemove={vi.fn()} />);

		expect(screen.getByText("Ada Lovelace (she/her)")).toBeTruthy();
		expect(
			screen.getByText("", { selector: '[data-avatar-name="Ada Lovelace (she/her)"]' }),
		).toBeTruthy();
	});
});
