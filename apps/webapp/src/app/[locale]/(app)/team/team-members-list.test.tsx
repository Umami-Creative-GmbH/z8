/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ManagedEmployee } from "./team-members-data";
import { TeamMembersList } from "./team-members-list";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
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
				]}
			/>,
		);

		expect(screen.getByText("+2h")).toBeTruthy();
		expect(screen.getByText("-3h")).toBeTruthy();
		expect(screen.getByText("0h")).toBeTruthy();
	});

	it("renders a sortable yearly balance table header", () => {
		render(<TeamMembersList employees={[employee({})]} />);

		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));

		expect(screen.getByRole("button", { name: "Sort by Year balance" })).toBeTruthy();
	});
});
