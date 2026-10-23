/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmployeeSelectItem } from "./employee-select-item";
import type { SelectableEmployee } from "./types";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span />,
}));

const employee: SelectableEmployee = {
	id: "emp_1",
	userId: "user_1",
	firstName: "Ada",
	lastName: "Lovelace",
	pronouns: null,
	position: null,
	role: "employee",
	isActive: true,
	teamId: null,
	user: { id: "user_1", name: "Ada Lovelace", email: "ada@example.com", image: null },
	team: null,
};

function renderItem(overrides: Partial<SelectableEmployee>) {
	render(
		<EmployeeSelectItem
			employee={{ ...employee, ...overrides }}
			isSelected={false}
			mode="single"
			onClick={vi.fn()}
		/>,
	);
}

describe("EmployeeSelectItem", () => {
	it("labels a former employee offered by a view of the past (#1438)", () => {
		renderItem({ isFormer: true });

		expect(screen.getByText("Former")).toBeTruthy();
		expect(screen.queryByText("Inactive")).toBeNull();
	});

	it("keeps the inactive label for an inactive employee not marked former", () => {
		renderItem({ isActive: false });

		expect(screen.getByText("Inactive")).toBeTruthy();
	});

	it("shows no status label for a current employee", () => {
		renderItem({});

		expect(screen.queryByText("Former")).toBeNull();
		expect(screen.queryByText("Inactive")).toBeNull();
	});
});
