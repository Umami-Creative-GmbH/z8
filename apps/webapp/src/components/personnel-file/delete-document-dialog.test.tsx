// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
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
		.mockResolvedValue({ success: true, data: { documentId: "doc" } });
	const closed = vi.fn(),
		deleted = vi.fn();
	render(<DeleteDocumentDialog document={document} onOpenChange={closed} onDeleted={deleted} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Reason (optional)" }), {
		target: { value: "Duplicate scan" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() => expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1));
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(closed).not.toHaveBeenCalled();
	const form = screen.getByRole("button", { name: "Delete" }).closest("form");
	if (!form) throw new Error("Delete confirmation form missing");
	const submission = new Event("submit", { bubbles: true, cancelable: true });
	fireEvent(form, submission);
	expect(submission.defaultPrevented).toBe(true);
	expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1);
	await act(async () => finish({ success: false, error: "Document not found" }));
	await screen.findByRole("alert");
	expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Duplicate scan");
	vi.mocked(deleteEmployeeDocumentAction).mockRejectedValueOnce(new Error("offline"));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(false),
	);
	expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await screen.findByText("Could not delete the document. Your reason is kept. Try again.");
	expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(2);
	expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Duplicate scan");
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Delete" }).hasAttribute("disabled")).toBe(false),
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
	expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(3);
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
			<DeleteDocumentDialog document={document} onOpenChange={closed} onDeleted={deleted} />
		</Activity>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() => expect(deleteEmployeeDocumentAction).toHaveBeenCalledTimes(1));
	view.rerender(
		<Activity mode="hidden">
			<DeleteDocumentDialog document={document} onOpenChange={closed} onDeleted={deleted} />
		</Activity>,
	);
	view.rerender(
		<Activity mode="visible">
			<DeleteDocumentDialog document={document} onOpenChange={closed} onDeleted={deleted} />
		</Activity>,
	);
	await act(async () => finish({ success: true, data: { documentId: "doc" } }));
	expect(deleted).not.toHaveBeenCalled();
	expect(closed).not.toHaveBeenCalled();
});

it("does not dispatch a confirmation removed before form validation completes", async () => {
	vi.mocked(deleteEmployeeDocumentAction).mockReset().mockResolvedValue({
		success: false,
		error: "Document not found",
	});
	const callbacks = { onOpenChange: vi.fn(), onDeleted: vi.fn() };
	const view = render(<DeleteDocumentDialog document={document} {...callbacks} />);
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();
	view.rerender(<DeleteDocumentDialog document={null} {...callbacks} />);
	await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
	expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();
});

it("retires queued validation across Activity return and permits a new confirmation", async () => {
	vi.mocked(deleteEmployeeDocumentAction).mockReset().mockResolvedValue({
		success: false,
		error: "Document not found",
	});
	const callbacks = { onOpenChange: vi.fn(), onDeleted: vi.fn() };
	const page = (mode: "visible" | "hidden") => (
		<Activity mode={mode}>
			<DeleteDocumentDialog document={document} {...callbacks} />
		</Activity>
	);
	const view = render(page("visible"));
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Duplicate scan" } });
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();
	view.rerender(page("hidden"));
	view.rerender(page("visible"));
	await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
	expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	await waitFor(() => expect(deleteEmployeeDocumentAction).toHaveBeenCalledOnce());
	expect(deleteEmployeeDocumentAction).toHaveBeenCalledWith({
		documentId: document.id,
		reason: "Duplicate scan",
	});
});

it("blocks Cancel and another activation while validation is queued", async () => {
	vi.mocked(deleteEmployeeDocumentAction).mockReset().mockResolvedValue({
		success: false,
		error: "Document not found",
	});
	const callbacks = { onOpenChange: vi.fn(), onDeleted: vi.fn() };
	render(<DeleteDocumentDialog document={document} {...callbacks} />);
	const form = screen.getByRole("button", { name: "Delete" }).closest("form");
	if (!form) throw new Error("Delete confirmation form missing");
	fireEvent.submit(form);
	expect(deleteEmployeeDocumentAction).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(callbacks.onOpenChange).not.toHaveBeenCalled();
	fireEvent.submit(form);
	await waitFor(() => expect(deleteEmployeeDocumentAction).toHaveBeenCalledOnce());
});
