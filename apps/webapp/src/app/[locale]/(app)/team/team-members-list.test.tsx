/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedEmployee } from "./team-members-data";
import { TeamMembersList } from "./team-members-list";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(label, [key, value]) => label.replace(`{${key}}`, value),
				fallback,
			),
	}),
}));
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

const employee = (overrides: Partial<ManagedEmployee>): ManagedEmployee => ({
	id: "employee-1",
	userId: "user-1",
	firstName: "Ada",
	lastName: "Lovelace",
	pronouns: null,
	position: "Manager",
	role: "manager",
	isActive: true,
	isPrimaryManager: false,
	isCurrentUser: false,
	timeBalance: null,
	user: {
		id: "user-1",
		firstName: "Ada",
		lastName: "Lovelace",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	},
	team: null,
	...overrides,
});

describe("TeamMembersList", () => {
	it("labels the search input for assistive technology", () => {
		render(<TeamMembersList employees={[employee({})]} />);

		expect(screen.getByRole("textbox", { name: "Search team members" })).toBeTruthy();
	});

	it("renders the You badge for the current user", () => {
		render(<TeamMembersList employees={[employee({ isCurrentUser: true })]} />);
		expect(screen.getByText("You")).toBeTruthy();
	});

	it("renders signed positive, negative, and zero balances", () => {
		render(
			<TeamMembersList
				employees={[
					employee({
						id: "employee-1",
						timeBalance: {
							year: 2026,
							actualMinutes: 600,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: 120,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
					employee({
						id: "employee-2",
						user: {
							id: "user-2",
							firstName: "Grace",
							lastName: "Hopper",
							name: "Grace Hopper",
							email: "grace@example.com",
							image: null,
						},
						timeBalance: {
							year: 2026,
							actualMinutes: 300,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: -180,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
					employee({
						id: "employee-3",
						user: {
							id: "user-3",
							firstName: "Katherine",
							lastName: "Johnson",
							name: "Katherine Johnson",
							email: "katherine@example.com",
							image: null,
						},
						timeBalance: {
							year: 2026,
							actualMinutes: 480,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: 0,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
					employee({
						id: "employee-4",
						user: {
							id: "user-4",
							firstName: "Dorothy",
							lastName: "Vaughan",
							name: "Dorothy Vaughan",
							email: "dorothy@example.com",
							image: null,
						},
					}),
				]}
			/>,
		);

		expect(screen.getByText("+2h")).toBeTruthy();
		expect(screen.getByText("-3h")).toBeTruthy();
		expect(screen.getByText("0h")).toBeTruthy();
		expect(screen.getByLabelText("Year balance: +2h")).toBeTruthy();
		expect(screen.getByLabelText("Year balance: -3h")).toBeTruthy();
		expect(screen.getByLabelText("Year balance: 0h")).toBeTruthy();
		expect(screen.getByLabelText("Year balance: No balance")).toBeTruthy();
	});

	it("renders You and balance badges in table mode", () => {
		render(
			<TeamMembersList
				employees={[
					employee({
						isCurrentUser: true,
						isPrimaryManager: true,
						timeBalance: {
							year: 2026,
							actualMinutes: 600,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: 120,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));

		expect(screen.getByText("You")).toBeTruthy();
		expect(screen.getByText("+2h")).toBeTruthy();
		expect(screen.getByTitle("You are the primary manager")).toBeTruthy();
	});

	it("renders and toggles an accessible sortable yearly balance table header", () => {
		render(
			<TeamMembersList
				employees={[
					employee({
						id: "employee-1",
						timeBalance: {
							year: 2026,
							actualMinutes: 600,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: 120,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
					employee({
						id: "employee-2",
						user: {
							id: "user-2",
							firstName: "Grace",
							lastName: "Hopper",
							name: "Grace Hopper",
							email: "grace@example.com",
							image: null,
						},
						timeBalance: {
							year: 2026,
							actualMinutes: 300,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: -180,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
					employee({
						id: "employee-3",
						user: {
							id: "user-3",
							firstName: "Katherine",
							lastName: "Johnson",
							name: "Katherine Johnson",
							email: "katherine@example.com",
							image: null,
						},
						timeBalance: {
							year: 2026,
							actualMinutes: 480,
							expectedMinutes: 480,
							absenceAdjustedMinutes: 0,
							balanceMinutes: 0,
							calculatedAt: new Date("2026-05-18T00:00:00.000Z"),
						},
					}),
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));

		const balanceHeader = screen.getByRole("columnheader", { name: /Year balance/ });
		const sortButton = screen.getByRole("button", { name: "Sort by Year balance" });
		expect(balanceHeader.getAttribute("aria-sort")).toBe("none");
		expect(sortButton.querySelector("svg")).toBeTruthy();

		fireEvent.click(sortButton);

		expect(balanceHeader.getAttribute("aria-sort")).toBe("ascending");
		expect(screen.getByRole("button", { name: "Sort by Year balance (ascending)" })).toBeTruthy();
		const bodyRows = screen.getAllByRole("row").slice(1);
		expect(bodyRows[0]?.textContent).toContain("Grace Hopper");
		expect(bodyRows[1]?.textContent).toContain("Katherine Johnson");
		expect(bodyRows[2]?.textContent).toContain("Ada Lovelace");
	});
});
