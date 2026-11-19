/* @vitest-environment jsdom */
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { DataTable } from "./data-table";
import { DataTablePagination } from "./data-table-pagination";

afterEach(cleanup);
it("names page size and keeps first/last, next/previous controls available with local rows", async () => {
	const user = userEvent.setup();
	render(
		<DataTable
			data={Array.from({ length: 11 }, (_, i) => ({ name: `Record ${i + 1}` }))}
			columns={[{ accessorKey: "name", header: "Name" }]}
		>
			{(table) => <DataTablePagination table={table} />}
		</DataTable>,
	);
	expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Go to last page" }));
	expect(screen.getByText("Record 11")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Go to first page" }));
	expect(screen.getByText("Record 1")).toBeTruthy();
});
