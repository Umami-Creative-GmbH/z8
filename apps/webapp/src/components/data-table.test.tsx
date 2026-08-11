/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "./data-table";

vi.mock("next/dynamic", () => ({
	default: () => () => null,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/hooks/use-mobile", () => ({
	useIsMobile: () => false,
}));

const rows = Array.from({ length: 11 }, (_, index) => ({
	id: index + 1,
	header: `Task ${index + 1}`,
	type: "Technical Approach",
	status: "In Progress",
	target: `${index + 1}`,
	limit: `${index + 11}`,
	reviewer: "Eddie Lake",
}));

describe("DataTable", () => {
	it("paginates rows and updates the selection summary", async () => {
		const user = userEvent.setup();
		render(<DataTable data={rows} />);

		expect(screen.getByText("Task 1")).toBeTruthy();
		expect(screen.queryByText("Task 11")).toBeNull();

		await user.click(screen.getByRole("button", { name: "Go to next page" }));

		expect(screen.getByText("Task 11")).toBeTruthy();
		await user.click(screen.getByRole("checkbox", { name: "Select row" }));
		expect(screen.getByText("1 of 11 row(s) selected.")).toBeTruthy();
	});
});
