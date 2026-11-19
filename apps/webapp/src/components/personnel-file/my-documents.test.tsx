// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";
import { MyDocumentsList } from "./my-documents-list";
import { MyDocumentsRetry } from "./my-documents-retry";
import { MyDocumentsScope } from "./my-documents-scope";
import { RequestedDocuments } from "./requested-documents";

const boundary = vi.hoisted(() => ({
	submit: vi.fn(),
	refresh: vi.fn(),
	scope: {
		userId: "user",
		activeOrganizationId: "org",
		employeeId: "employee",
	},
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) => String(params?.[key] ?? match)),
	}),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: boundary.refresh }),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en-GB",
}));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	submitDocumentRequestAction: boundary.submit,
}));

const capability = {
	employeeId: "employee",
	categories: ["certificate" as const, "other" as const],
	today: "2026-11-15",
	timezone: "Europe/Berlin",
};
function request(id: string, overrides: Partial<DocumentRequestView> = {}): DocumentRequestView {
	return {
		id,
		title: id,
		employeeId: "employee",
		category: "certificate",
		note: null,
		deadline: "2026-11-30",
		status: "open",
		overdue: false,
		version: 1,
		renewedDocument: null,
		createdByName: null,
		createdAt: "2026-11-15T12:00:00Z",
		history: [],
		submissions: [],
		pendingDocuments: [],
		...overrides,
	};
}
beforeEach(() => vi.clearAllMocks());

it("keeps upload reachable in the original empty shared-document state", () => {
	render(
		<MyDocumentsList documents={[]} actions={<button type="button">Upload document</button>} />,
	);
	expect(screen.getByText("No documents have been shared with you yet.")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Upload document" })).toBeTruthy();
});

it("retries the real route data owner after a failed read", () => {
	render(<MyDocumentsRetry />);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.refresh).toHaveBeenCalledTimes(1);
});

it("filters shared records without losing metadata or the access-checked destinations", async () => {
	const common = {
		employeeId: "employee",
		documentDate: "2026-11-01",
		payPeriod: null,
		visibility: "shared" as const,
		expiryDate: null,
		mimeType: "application/pdf",
		sizeBytes: 44,
		createdAt: "2026-11-01T12:00:00Z",
		absence: null,
		skill: null,
	};
	render(
		<MyDocumentsList
			documents={[
				{
					...common,
					id: "certificate",
					category: "certificate",
					title: "Safety certificate",
					fileName: "safety.pdf",
					expiryDate: "2027-11-01",
				},
				{
					...common,
					id: "payslip",
					category: "payslip",
					title: "October pay",
					fileName: "pay.pdf",
					payPeriod: { year: 2026, month: 10 },
				},
			]}
		/>,
	);
	fireEvent.click(screen.getByRole("combobox", { name: "Filter by category" }));
	fireEvent.click(await screen.findByRole("option", { name: "Certificate" }));
	expect(screen.queryByText("October pay")).toBeNull();
	expect(screen.getByText(/safety.pdf/)).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Download Safety certificate" }).getAttribute("href"),
	).toBe("/api/personnel-files/documents/certificate?download=1");
	fireEvent.click(screen.getByRole("combobox", { name: "Filter by category" }));
	fireEvent.click(await screen.findByRole("option", { name: "All categories" }));
	expect(screen.getByText("October pay")).toBeTruthy();
	expect(screen.getByText(/Pay period October 2026/)).toBeTruthy();
});

it("leads with employee work in deadline order and keeps completed requests accessible", () => {
	render(
		<RequestedDocuments
			capability={capability}
			requests={[
				request("accepted", { status: "accepted" }),
				request("later"),
				request("overdue", { deadline: "2026-11-01", overdue: true }),
				request("submitted", { status: "submitted" }),
			]}
		/>,
	);
	const lists = screen
		.getAllByRole("list")
		.filter((list) => list.parentElement?.tagName !== "DETAILS");
	expect(
		within(lists[0])
			.getAllByRole("listitem")
			.map((item) => item.textContent),
	).toEqual([expect.stringContaining("overdue"), expect.stringContaining("later")]);
	expect(screen.getByText("accepted")).toBeTruthy();
	expect(screen.getByText("submitted")).toBeTruthy();
	expect(screen.queryByRole("button", { name: /Accept|Return|Cancel request/ })).toBeNull();
});

it("retains the submission note and shows a retryable failure inside the confirmation", async () => {
	boundary.submit
		.mockResolvedValueOnce({ success: false, error: "Try again" })
		.mockResolvedValueOnce({ success: true });
	render(
		<RequestedDocuments
			capability={capability}
			requests={[
				request("Renewal", {
					pendingDocuments: [
						{
							id: "document",
							title: "Certificate",
							fileName: "certificate.pdf",
							mimeType: "application/pdf",
						},
					],
				}),
			]}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Submit Renewal" }));
	const dialog = screen.getByRole("alertdialog");
	fireEvent.change(within(dialog).getByRole("textbox"), {
		target: { value: "Original note" },
	});
	const form = within(dialog).getByRole("textbox").closest("form");
	if (!form) throw new Error("Expected the real submission form");
	fireEvent.submit(form);
	expect(await within(dialog).findByRole("alert")).toBeTruthy();
	expect((within(dialog).getByRole("textbox") as HTMLTextAreaElement).value).toBe("Original note");
	fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
	await waitFor(() => expect(boundary.submit).toHaveBeenCalledTimes(2));
	expect(boundary.submit).toHaveBeenLastCalledWith({
		requestId: "Renewal",
		note: "Original note",
		expectedVersion: 1,
	});
});

it("removes stale records and open tasks when the displayed account or organization changes", () => {
	const { rerender } = render(
		<MyDocumentsScope userId="user" organizationId="org" employeeId="employee">
			<button type="button">Employee task</button>
		</MyDocumentsScope>,
	);
	expect(screen.getByRole("button", { name: "Employee task" })).toBeTruthy();
	boundary.scope = {
		userId: "other",
		activeOrganizationId: "org",
		employeeId: "employee",
	};
	rerender(
		<MyDocumentsScope userId="user" organizationId="org" employeeId="employee">
			<button type="button">Employee task</button>
		</MyDocumentsScope>,
	);
	expect(screen.queryByRole("button", { name: "Employee task" })).toBeNull();
	boundary.scope = {
		userId: "user",
		activeOrganizationId: "foreign-org",
		employeeId: "employee",
	};
	rerender(
		<MyDocumentsScope userId="user" organizationId="org" employeeId="employee">
			<button type="button">Employee task</button>
		</MyDocumentsScope>,
	);
	expect(screen.queryByRole("button", { name: "Employee task" })).toBeNull();
});

it("prevents native duplicate submissions and dismissal while the real command is pending", async () => {
	let settle!: (value: { success: false; error: string }) => void;
	boundary.submit.mockImplementation(
		() =>
			new Promise((resolve) => {
				settle = resolve;
			}),
	);
	render(
		<RequestedDocuments
			capability={capability}
			requests={[
				request("Pending", {
					pendingDocuments: [
						{
							id: "document",
							title: "Certificate",
							fileName: "certificate.pdf",
							mimeType: "application/pdf",
						},
					],
				}),
			]}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Submit Pending" }));
	const dialog = screen.getByRole("alertdialog"),
		form = within(dialog).getByRole("textbox").closest("form");
	if (!form) throw new Error("Expected the real submission form");
	fireEvent.submit(form);
	await waitFor(() => expect(boundary.submit).toHaveBeenCalledTimes(1));
	await act(async () => {
		fireEvent.submit(form);
		fireEvent.keyDown(dialog, { key: "Escape" });
	});
	expect(boundary.submit).toHaveBeenCalledTimes(1);
	expect(screen.getByRole("alertdialog")).toBeTruthy();
	expect(
		(
			within(dialog).getByRole("button", {
				name: "Cancel",
			}) as HTMLButtonElement
		).disabled,
	).toBe(true);
	settle({ success: false, error: "Try again" });
	await within(dialog).findByRole("alert");
});
