/* @vitest-environment jsdom */

import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentRequestsInBulkAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import type { SelectableEmployee } from "@/components/employee-select";
import type { DocumentRequestRecipientOptions } from "@/lib/personnel-file/document-request-overview";
import { render } from "@/test/render-with-translations";
import { BulkDocumentRequestsDialog } from "./bulk-document-requests-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: { children?: ReactNode; open: boolean }) =>
			open ? <div>{children}</div> : null,
		ActionPanelBody: Pass,
		ActionPanelContent: Pass,
		ActionPanelDescription: Pass,
		ActionPanelFooter: Pass,
		ActionPanelHeader: Pass,
		ActionPanelTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
	};
});
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({ value, onChange }: { value?: string | null; onChange: (v: string) => void }) => (
		<input
			aria-label="Deadline picker"
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));
// The employee picker is a searchable modal; a checkbox per offered employee stands in for it.
vi.mock("@/components/employee-select", () => ({
	EmployeeMultiSelect: ({
		label,
		value,
		onChange,
		employees = [],
		error,
	}: {
		label: string;
		value: string[];
		onChange: (value: string[]) => void;
		employees?: SelectableEmployee[];
		error?: string;
	}) => (
		<fieldset aria-invalid={error ? true : undefined}>
			<legend>{label}</legend>
			{error ? <p>{error}</p> : null}
			{employees.map((employee) => (
				<label key={employee.id}>
					<input
						type="checkbox"
						checked={value.includes(employee.id)}
						onChange={(event) =>
							onChange(
								event.target.checked
									? [...value, employee.id]
									: value.filter((id) => id !== employee.id),
							)
						}
					/>
					{employee.user.name}
				</label>
			))}
		</fieldset>
	),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	createDocumentRequestsInBulkAction: vi.fn(),
}));

const certificateOptions: DocumentRequestRecipientOptions = {
	certificate: {
		employees: [
			{ id: "anna", name: "Anna Example" },
			{ id: "dana", name: "Dana Example" },
		],
		teams: [
			{ id: "berlin", name: "Berlin" },
			{ id: "hamburg", name: "Hamburg" },
		],
	},
	other: { employees: [], teams: [] },
};

function renderDialog(options: DocumentRequestRecipientOptions = certificateOptions) {
	const onCreated = vi.fn();
	const onOpenChange = vi.fn();
	render(
		<BulkDocumentRequestsDialog
			open
			onOpenChange={onOpenChange}
			options={options}
			today="2026-10-18"
			onCreated={onCreated}
		/>,
	);
	return { onCreated, onOpenChange };
}

function fillRequest() {
	fireEvent.change(screen.getByRole("textbox", { name: /^Title/ }), {
		target: { value: "First aid refresher" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "Note (optional)" }), {
		target: { value: "Please upload the new card." },
	});
	fireEvent.change(screen.getByLabelText("Deadline picker"), { target: { value: "2026-11-30" } });
}

beforeEach(() => {
	vi.mocked(toast.error).mockReset();
	vi.mocked(toast.success).mockReset();
	vi.mocked(createDocumentRequestsInBulkAction).mockReset();
});

describe("requesting a document from several employees at once", () => {
	it("sends the chosen teams and employees with one request and shows how many were skipped", async () => {
		vi.mocked(createDocumentRequestsInBulkAction).mockResolvedValue({
			success: true,
			data: {
				created: 2,
				skipped: 3,
				skippedBy: { not_covered: 1, own_file: 1, former_employee: 0, already_requested: 1 },
			},
		});
		const { onCreated } = renderDialog();
		fireEvent.click(screen.getByRole("switch", { name: "Berlin" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Dana Example" }));
		fillRequest();
		fireEvent.click(screen.getByRole("button", { name: "Request" }));

		await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
		expect(createDocumentRequestsInBulkAction).toHaveBeenCalledWith({
			category: "certificate",
			teamIds: ["berlin"],
			employeeIds: ["dana"],
			title: "First aid refresher",
			note: "Please upload the new card.",
			deadline: "2026-11-30",
		});
		expect(screen.getByText("2 document requests created.")).toBeTruthy();
		expect(screen.getByText("3 employees skipped:")).toBeTruthy();
		expect(screen.getByText("1 not covered by your access")).toBeTruthy();
		expect(screen.getByText("Your own file")).toBeTruthy();
		expect(screen.getByText("1 already has an open request with this title")).toBeTruthy();
		expect(screen.queryByText(/former employee/)).toBeNull();
	});

	it("asks for at least one team or employee before sending anything", async () => {
		renderDialog();
		fillRequest();
		fireEvent.click(screen.getByRole("button", { name: "Request" }));
		expect(await screen.findByText("Choose at least one employee or team.")).toBeTruthy();
		expect(createDocumentRequestsInBulkAction).not.toHaveBeenCalled();
	});

	it("words a refusal in the app language", async () => {
		vi.mocked(createDocumentRequestsInBulkAction).mockResolvedValue({
			success: false,
			error: "Server wording",
			code: "too_many_recipients",
		});
		const { onCreated } = renderDialog();
		fireEvent.click(screen.getByRole("switch", { name: "Hamburg" }));
		fillRequest();
		fireEvent.click(screen.getByRole("button", { name: "Request" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Request documents from at most 500 employees at once.",
			),
		);
		expect(onCreated).not.toHaveBeenCalled();
	});

	it("offers the employees and teams of the category the officer covers", () => {
		renderDialog({
			certificate: { employees: [], teams: [] },
			other: {
				employees: [{ id: "ben", name: "Ben Example" }],
				teams: [{ id: "office", name: "Office" }],
			},
		});
		expect(screen.getByRole("checkbox", { name: "Ben Example" })).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Office" })).toBeTruthy();
		expect(screen.queryByRole("switch", { name: "Berlin" })).toBeNull();
	});
});
