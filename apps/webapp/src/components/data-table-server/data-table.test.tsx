/* @vitest-environment jsdom */

import type {
	ColumnDef,
	RowSelectionState,
	SortingState,
} from "@tanstack/react-table";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import { DataTable } from "./data-table";
import type { DataTableFeatures } from "./data-table-features";
import { createSelectionColumn } from "./selection-column";

afterEach(cleanup);
type RecordRow = { id: string; name: string };
const columns: ColumnDef<DataTableFeatures, RecordRow>[] = [
	createSelectionColumn<RecordRow>(),
	{
		accessorKey: "name",
		header: ({ column }) => (
			<button type="button" onClick={() => column.toggleSorting(false)}>
				Name
			</button>
		),
		cell: ({ row }) => (
			<input
				aria-label={`Note ${row.original.name}`}
				defaultValue={row.original.name}
			/>
		),
	},
];

function ServerRecords() {
	const [page, setPage] = useState(0);
	const [selection, setSelection] = useState<RowSelectionState>({});
	const [sorting, setSorting] = useState<SortingState>([]);
	const [pending, setPending] = useState(false);
	return (
		<>
			<DataTable
				columns={columns}
				data={
					page === 0
						? [{ id: "alpha", name: "Alex" }]
						: [{ id: "beta", name: "Blair" }]
				}
				getRowId={(row) => row.id}
				enableRowSelection
				manualPagination
				manualSorting
				pagination={{ pageIndex: page, pageSize: 1 }}
				pageCount={2}
				rowSelection={selection}
				onRowSelectionChange={setSelection}
				sorting={sorting}
				onSortingChange={setSorting}
				isFetching={pending}
				mobileLayout="stacked"
			/>
			<button type="button" onClick={() => setPage(page ? 0 : 1)}>
				Change page
			</button>
			<button type="button" onClick={() => setPending(!pending)}>
				Refresh
			</button>
			<output>
				{Object.entries(selection)
					.filter(([, selected]) => selected)
					.map(([id]) => id)
					.join(",")}
			</output>
		</>
	);
}

describe("record table contract", () => {
	it("exposes sort direction and busy state while retaining the mounted draft and stable selected IDs across server pages", async () => {
		const user = userEvent.setup();
		render(<ServerRecords />);
		const draft = screen.getByRole("textbox", { name: "Note Alex" });
		await user.type(draft, " draft");
		await user.click(screen.getByRole("button", { name: "Name" }));
		expect(
			screen
				.getByRole("columnheader", { name: "Name" })
				.getAttribute("aria-sort"),
		).toBe("ascending");
		await user.click(screen.getByRole("button", { name: "Refresh" }));
		expect(screen.getByRole("table").getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("textbox", { name: "Note Alex" })).toBe(draft);
		expect(screen.getByDisplayValue("Alex draft")).toBe(draft);
		await user.click(screen.getByRole("checkbox", { name: "Select all" }));
		await user.click(screen.getByRole("button", { name: "Change page" }));
		expect(
			screen
				.getByRole("checkbox", { name: "Select row" })
				.getAttribute("aria-checked"),
		).toBe("false");
		await user.click(screen.getByRole("checkbox", { name: "Select all" }));
		expect(screen.getByRole("status").textContent).toBe("alpha,beta");
		expect(
			within(screen.getByRole("table")).getAllByRole("textbox"),
		).toHaveLength(1);
	});
	it("sorts local rows by the actual column while keeping drafts attached to stable record IDs", async () => {
		const user = userEvent.setup();
		render(
			<DataTable
				columns={columns}
				data={[
					{ id: "beta", name: "Blair" },
					{ id: "alpha", name: "Alex" },
				]}
				getRowId={(row) => row.id}
			/>,
		);
		const draft = screen.getByRole("textbox", { name: "Note Blair" });
		await user.type(draft, " draft");
		await user.click(screen.getByRole("button", { name: "Name" }));
		expect(
			screen
				.getAllByRole("textbox")
				.map((node) => node.getAttribute("aria-label")),
		).toEqual(["Note Alex", "Note Blair"]);
		expect(screen.getByDisplayValue("Blair draft")).toBe(draft);
	});
});
