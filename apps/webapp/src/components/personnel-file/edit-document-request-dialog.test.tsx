/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";
import { EditDocumentRequestDialog } from "./edit-document-request-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	editDocumentRequestAction: vi.fn(),
}));

const request = {
	id: "request-1",
	employeeId: "employee-1",
	category: "certificate",
	title: "First aid refresher",
	note: "Please upload the new card.",
	deadline: "2026-10-31",
	status: "open",
	overdue: false,
	version: 3,
} as unknown as DocumentRequestView;

function renderDialog() {
	const onSaved = vi.fn();
	const onOpenChange = vi.fn();
	render(
		<EditDocumentRequestDialog
			request={request}
			today="2026-10-18"
			onOpenChange={onOpenChange}
			onSaved={onSaved}
		/>,
	);
	return { onSaved, onOpenChange };
}

beforeEach(() => {
	vi.mocked(toast.error).mockReset();
	vi.mocked(toast.success).mockReset();
	vi.mocked(editDocumentRequestAction).mockReset();
});

describe("changing a request's deadline and note", () => {
	it("starts from the request and saves the new deadline and note against its version", async () => {
		vi.mocked(editDocumentRequestAction).mockResolvedValue({
			success: true,
			data: { ...request, deadline: "2026-11-15", note: "Bring both pages.", version: 4 },
		});
		const { onSaved, onOpenChange } = renderDialog();
		const deadline = screen.getByLabelText("Deadline picker");
		const note = screen.getByRole("textbox", { name: "Note (optional)" });
		expect(deadline).toHaveProperty("value", "2026-10-31");
		expect(note).toHaveProperty("value", "Please upload the new card.");

		fireEvent.change(deadline, { target: { value: "2026-11-15" } });
		fireEvent.change(note, { target: { value: "Bring both pages." } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

		await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
		expect(editDocumentRequestAction).toHaveBeenCalledWith({
			requestId: "request-1",
			deadline: "2026-11-15",
			note: "Bring both pages.",
			expectedVersion: 3,
		});
		expect(toast.success).toHaveBeenCalledWith("Request changed");
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it.each([
		["deadline_in_past", "The deadline cannot be in the past."],
		[
			"not_editable",
			"Only the deadline and note can be changed. Cancel the request and create a new one instead.",
		],
		["conflict", "Someone else changed this request in the meantime. Reload it and try again."],
	])("words the %s refusal in the app language", async (code, text) => {
		vi.mocked(editDocumentRequestAction).mockResolvedValue({
			success: false,
			error: "Server wording",
			code,
		});
		const { onSaved } = renderDialog();
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		await waitFor(() => expect(toast.error).toHaveBeenCalledWith(text));
		// A conflict means the list is stale: it is reloaded.
		expect(onSaved).toHaveBeenCalledTimes(code === "conflict" ? 1 : 0);
	});
});
