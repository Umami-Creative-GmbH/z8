// @vitest-environment jsdom

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { expect, it, vi } from "vitest";
import { deleteEmployeeDocumentAction } from "@/app/[locale]/(app)/personnel-files/actions";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import { DeleteDocumentDialog } from "./delete-document-dialog";

vi.mock("@/app/[locale]/(app)/personnel-files/actions", () => ({
	deleteEmployeeDocumentAction: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) =>
				String(params?.[key] ?? match),
			),
	}),
}));
const document: EmployeeDocumentView = {
	id: "doc",
	employeeId: "employee",
	title: "Safety qualification",
	category: "certificate",
	visibility: "shared",
	documentDate: "2026-01-15",
	payPeriod: null,
	expiryDate: null,
	fileName: "safety.pdf",
	mimeType: "application/pdf",
	sizeBytes: 10,
	createdAt: "2026-01-15T12:00:00Z",
	absence: null,
	skill: null,
};

it("retains the audit reason through rejected transport, guards pending dismissal/duplicates, and retries", async () => {
	let finish!: (value: { success: false; error: string }) => void;
	vi.mocked(deleteEmployeeDocumentAction)
		.mockReset()
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		)
		.mockResolvedValueOnce({ success: false, error: "Document not found" })
		.mockResolvedValue({ success: true, data: { documentId: "doc" } });
	const closed = vi.fn(),
		deleted = vi.fn();
	render(
		<DeleteDocumentDialog
			document={document}
			onOpenChange={closed}
			onDeleted={deleted}
		/>,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Reason (optional)" }), {
		target: { value: "Duplicate scan" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() =>
		expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1),
	);
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(closed).not.toHaveBeenCalled();
	const form = screen.getByRole("button", { name: "Delete" }).closest("form");
	if (!form) throw new Error("Delete confirmation form missing");
	fireEvent.submit(form);
	expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1);
	await act(async () =>
		finish({ success: false, error: "Document not found" }),
	);
	await screen.findByRole("alert");
	expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
		"Duplicate scan",
	);
	vi.mocked(deleteEmployeeDocumentAction).mockRejectedValueOnce(
		new Error("offline"),
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await screen.findByText(
		"Could not delete the document. Your reason is kept. Try again.",
	);
	expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
		"Duplicate scan",
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
	expect(deleteEmployeeDocumentAction).toHaveBeenLastCalledWith({
		documentId: "doc",
		reason: "Duplicate scan",
	});
});

it("does not close a resumed task or announce late completion after Activity suspension", async () => {
	let finish!: (value: { success: true; data: { documentId: string } }) => void;
	vi.mocked(deleteEmployeeDocumentAction)
		.mockReset()
		.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
	const deleted = vi.fn(),
		closed = vi.fn();
	const view = render(
		<Activity mode="visible">
			<DeleteDocumentDialog
				document={document}
				onOpenChange={closed}
				onDeleted={deleted}
			/>
		</Activity>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() =>
		expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1),
	);
	view.rerender(
		<Activity mode="hidden">
			<DeleteDocumentDialog
				document={document}
				onOpenChange={closed}
				onDeleted={deleted}
			/>
		</Activity>,
	);
	view.rerender(
		<Activity mode="visible">
			<DeleteDocumentDialog
				document={document}
				onOpenChange={closed}
				onDeleted={deleted}
			/>
		</Activity>,
	);
	await act(async () => finish({ success: true, data: { documentId: "doc" } }));
	expect(deleted).not.toHaveBeenCalled();
	expect(closed).not.toHaveBeenCalled();
});
