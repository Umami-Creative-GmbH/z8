/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedEmployee } from "./team-members-data";
import { TeamMembersList } from "./team-members-list";

const { getActivityMock } = vi.hoisted(() => ({
	getActivityMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			fallback: string,
			params?: Record<string, string | number>,
		) =>
			Object.entries(params ?? {}).reduce(
				(label, [key, value]) => label.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("@/components/employee-activity-text", () => ({
	EmployeeActivityText: ({
		lastActivityAt,
		lastActivityUtcOffsetMinutes,
	}: {
		lastActivityAt: string | null;
		lastActivityUtcOffsetMinutes: number | null;
	}) =>
		lastActivityAt === null || lastActivityUtcOffsetMinutes === null ? null : (
			<span>
				activity:{lastActivityAt}:{lastActivityUtcOffsetMinutes}
			</span>
		),
}));
vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({
		getStatus: () => "unknown",
		getActivity: getActivityMock,
	}),
}));
vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		...props
	}: {
		href: string;
		children: ReactNode;
	}) => (
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

const timeBalance = (
	employeeId: string,
	actualMinutes: number,
	requiredMinutes: number,
) => ({
	employeeId,
	organizationId: "org-1",
	actualMinutes,
	requiredMinutes,
	balanceMinutes: actualMinutes - requiredMinutes,
	computedFromDate: "2026-01-01",
	computedThroughDate: "2026-05-17",
	computedAt: new Date("2026-05-18T00:00:00.000Z"),
});

describe("TeamMembersList", () => {
	beforeEach(() => {
		getActivityMock.mockReset().mockReturnValue(null);
	});

	it("labels the search input for assistive technology", () => {
		render(<TeamMembersList employees={[employee({})]} />);

		expect(
			screen.getByRole("textbox", { name: "Search team members" }),
		).toBeTruthy();
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
						timeBalance: timeBalance("employee-1", 600, 480),
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
						timeBalance: timeBalance("employee-2", 479, 1080),
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
						timeBalance: timeBalance("employee-3", 480, 480),
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

		expect(screen.getByText("+2:00h")).toBeTruthy();
		expect(screen.getByText("-10:01h")).toBeTruthy();
		expect(screen.getByText("0:00h")).toBeTruthy();
		expect(screen.getByLabelText("All-time balance: +2:00h")).toBeTruthy();
		expect(screen.getByLabelText("All-time balance: -10:01h")).toBeTruthy();
		expect(screen.getByLabelText("All-time balance: 0:00h")).toBeTruthy();
		expect(screen.getByLabelText("All-time balance: No balance")).toBeTruthy();
	});

	it("renders You and balance badges in table mode", () => {
		render(
			<TeamMembersList
				employees={[
					employee({
						isCurrentUser: true,
						isPrimaryManager: true,
						timeBalance: timeBalance("employee-1", 600, 480),
					}),
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));

		expect(screen.getByText("You")).toBeTruthy();
		expect(screen.getByText("+2:00h")).toBeTruthy();
		expect(screen.getByTitle("You are the primary manager")).toBeTruthy();
	});

	it("renders employee clock activity metadata in card and table views", () => {
		getActivityMock.mockReturnValue({
			lastActivityAt: "2026-07-28T10:40:00.000Z",
			lastActivityUtcOffsetMinutes: 120,
		});

		render(<TeamMembersList employees={[employee({})]} />);

		expect(
			screen.getByText("activity:2026-07-28T10:40:00.000Z:120"),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));
		expect(
			screen.getByText("activity:2026-07-28T10:40:00.000Z:120"),
		).toBeTruthy();
		expect(getActivityMock).toHaveBeenCalledWith("employee-1");
	});

	it("renders and toggles an accessible sortable all-time balance table header", () => {
		render(
			<TeamMembersList
				employees={[
					employee({
						id: "employee-1",
						timeBalance: timeBalance("employee-1", 600, 480),
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
						timeBalance: timeBalance("employee-2", 479, 1080),
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
						timeBalance: timeBalance("employee-3", 480, 480),
					}),
				]}
			/>,
		);

		fireEvent.click(screen.getByRole("radio", { name: "Table view" }));

		const balanceHeader = screen.getByRole("columnheader", {
			name: /All-time balance/,
		});
		const sortButton = screen.getByRole("button", { name: "All-time balance" });
		expect(balanceHeader.getAttribute("aria-sort")).toBe("none");
		expect(sortButton.querySelector("svg")).toBeTruthy();

		fireEvent.click(sortButton);

		expect(balanceHeader.getAttribute("aria-sort")).toBe("ascending");
		expect(
			screen.getByRole("button", { name: "All-time balance (ascending)" }),
		).toBeTruthy();
		const bodyRows = screen.getAllByRole("row").slice(1);
		expect(bodyRows[0]?.textContent).toContain("Grace Hopper");
		expect(bodyRows[1]?.textContent).toContain("Katherine Johnson");
		expect(bodyRows[2]?.textContent).toContain("Ada Lovelace");
	});
});
