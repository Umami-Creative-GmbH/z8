/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "./table";

afterEach(cleanup);

function Details({
	label = "Employee",
	onAction,
}: {
	label?: string;
	onAction: () => void;
}) {
	return (
		<Table mobileLayout="stacked">
			<TableHeader>
				<TableRow>
					<TableHead>{label}</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				<TableRow>
					<TableCell>Alex</TableCell>
					<TableCell>Active</TableCell>
					<TableCell>
						<button type="button" onClick={onAction}>
							Review Alex
						</button>
					</TableCell>
				</TableRow>
				<TableRow>
					<TableCell colSpan={3}>No further employees</TableCell>
				</TableRow>
			</TableBody>
		</Table>
	);
}

describe("phone table details", () => {
	it("labels the existing cells with rendered headers and preserves action identity", () => {
		const onAction = vi.fn();
		const view = render(<Details onAction={onAction} />);
		const action = screen.getByRole("button", { name: "Review Alex" });
		expect(screen.getByRole("cell", { name: "Alex" }).dataset.label).toBe(
			"Employee",
		);
		expect(screen.getByRole("cell", { name: "Active" }).dataset.label).toBe(
			"Status",
		);
		expect(
			screen.getByRole("cell", { name: "No further employees" }).dataset.label,
		).toBe("");
		view.rerender(<Details label="Mitarbeiter" onAction={onAction} />);
		expect(screen.getByRole("cell", { name: "Alex" }).dataset.label).toBe(
			"Mitarbeiter",
		);
		expect(screen.getByRole("button", { name: "Review Alex" })).toBe(action);
		fireEvent.click(action);
		expect(onAction).toHaveBeenCalledOnce();
	});
	it("preserves native cell content and forwarded refs for ordinary tables", () => {
		const ref = createRef<HTMLTableElement>();
		render(
			<Table ref={ref}>
				<TableBody>
					<TableRow>
						<TableCell>Reference matrix</TableCell>
					</TableRow>
				</TableBody>
			</Table>,
		);
		expect(ref.current).toBe(screen.getByRole("table"));
		expect(screen.getByRole("cell").textContent).toBe("Reference matrix");
		expect(
			screen.getByRole("cell").querySelector("[data-slot=table-cell-value]"),
		).toBeNull();
	});
});
