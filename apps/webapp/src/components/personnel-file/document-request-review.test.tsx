/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";
import type { PersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { DocumentRequestDecisionActions } from "./document-request-decision";
import { RequestedDocuments } from "./requested-documents";

const mocks = vi.hoisted(() => ({
	acceptDocumentRequestAction: vi.fn(),
	returnDocumentRequestAction: vi.fn(),
	submitDocumentRequestAction: vi.fn(),
	refresh: vi.fn(),
	uploadDialogs: [] as Array<{ documentRequest?: { id: string; category: string } }>,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key)
				.replace(/\{count, plural, one \{# ([^}]*)\} other \{# ([^}]*)\}\}/gu, (_m, one, other) =>
					params?.count === 1 ? `1 ${one}` : `${String(params?.count)} ${other}`,
				)
				.replace(/\{(\w+)\}/gu, (match, name: string) =>
					params && name in params ? String(params[name]) : match,
				),
	}),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	acceptDocumentRequestAction: mocks.acceptDocumentRequestAction,
	returnDocumentRequestAction: mocks.returnDocumentRequestAction,
	submitDocumentRequestAction: mocks.submitDocumentRequestAction,
}));
vi.mock("./document-dialog", () => ({
	DocumentDialog: (props: { documentRequest?: { id: string; category: string } }) => {
		mocks.uploadDialogs.push(props);
		return <div data-testid="upload-dialog" />;
	},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function request(overrides: Partial<DocumentRequestView> = {}): DocumentRequestView {
	return {
		id: "request-1",
		employeeId: "employee-1",
		category: "certificate",
		title: "First aid refresher",
		note: null,
		deadline: "2099-11-30",
		status: "submitted",
		overdue: false,
		version: 3,
		renewedDocument: null,
		createdByName: "Otto Officer",
		createdAt: "2026-10-18T08:00:00.000Z",
		history: [],
		submissions: [],
		pendingDocuments: [],
		...overrides,
	};
}

const capability: PersonnelFilePanelCapability = {
	employeeId: "employee-1",
	categories: ["certificate", "other"],
	today: "2026-10-18",
	timezone: "Europe/Berlin",
};

describe("an officer's decision on a submitted request (#1402)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("offers no decision before the employee submitted", () => {
		render(
			<DocumentRequestDecisionActions request={request({ status: "open" })} onDecided={vi.fn()} />,
		);
		expect(screen.queryByRole("button", { name: "Accept First aid refresher" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Return First aid refresher" })).toBeNull();
	});

	it("accepts the version the officer saw", async () => {
		mocks.acceptDocumentRequestAction.mockResolvedValue({ success: true, data: request() });
		const onDecided = vi.fn();
		render(<DocumentRequestDecisionActions request={request()} onDecided={onDecided} />);
		fireEvent.click(screen.getByRole("button", { name: "Accept First aid refresher" }));
		fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
		await waitFor(() => expect(onDecided).toHaveBeenCalled());
		expect(mocks.acceptDocumentRequestAction).toHaveBeenCalledWith({
			requestId: "request-1",
			expectedVersion: 3,
		});
		expect(toast.success).toHaveBeenCalledWith("Request accepted");
	});

	it("returns only with a reason", async () => {
		mocks.returnDocumentRequestAction.mockResolvedValue({ success: true, data: request() });
		const onDecided = vi.fn();
		render(<DocumentRequestDecisionActions request={request()} onDecided={onDecided} />);
		fireEvent.click(screen.getByRole("button", { name: "Return First aid refresher" }));
		fireEvent.click(await screen.findByRole("button", { name: "Return to employee" }));
		expect(await screen.findByText("Enter a reason.")).toBeTruthy();
		expect(mocks.returnDocumentRequestAction).not.toHaveBeenCalled();

		fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unreadable scan" } });
		fireEvent.click(screen.getByRole("button", { name: "Return to employee" }));
		await waitFor(() => expect(onDecided).toHaveBeenCalled());
		expect(mocks.returnDocumentRequestAction).toHaveBeenCalledWith({
			requestId: "request-1",
			reason: "Unreadable scan",
			expectedVersion: 3,
		});
	});

	it("explains a decision someone else made first and reloads", async () => {
		mocks.acceptDocumentRequestAction.mockResolvedValue({
			success: false,
			error: "Server wording",
			code: "conflict",
		});
		const onDecided = vi.fn();
		render(<DocumentRequestDecisionActions request={request()} onDecided={onDecided} />);
		fireEvent.click(screen.getByRole("button", { name: "Accept First aid refresher" }));
		fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Someone else changed this request in the meantime. Reload it and try again.",
			),
		);
		expect(onDecided).toHaveBeenCalled();
	});
});

describe("the employee's requested documents (#1402)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.uploadDialogs.length = 0;
	});

	it("uploads for an open request in its category, and submits only once something is uploaded", () => {
		render(<RequestedDocuments requests={[request({ status: "open" })]} capability={capability} />);
		expect(
			screen.getByRole("button", { name: "Submit First aid refresher" }).hasAttribute("disabled"),
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Upload a document for First aid refresher" }),
		);
		expect(screen.getByTestId("upload-dialog")).toBeTruthy();
		expect(mocks.uploadDialogs.at(-1)?.documentRequest).toEqual({
			id: "request-1",
			category: "certificate",
			title: "First aid refresher",
		});
	});

	it("submits the uploaded documents with a note", async () => {
		mocks.submitDocumentRequestAction.mockResolvedValue({ success: true, data: request() });
		const pending = request({
			status: "open",
			pendingDocuments: [
				{
					id: "document-1",
					title: "First aid card",
					fileName: "card.pdf",
					mimeType: "application/pdf",
				},
			],
		});
		render(<RequestedDocuments requests={[pending]} capability={capability} />);
		expect(screen.getByText("Uploaded, not submitted yet")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Submit First aid refresher" }));
		expect(await screen.findByText(/1 document is handed in/u)).toBeTruthy();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "Back side follows" } });
		fireEvent.click(screen.getByRole("button", { name: "Submit" }));
		await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
		expect(mocks.submitDocumentRequestAction).toHaveBeenCalledWith({
			requestId: "request-1",
			note: "Back side follows",
			expectedVersion: 3,
		});
	});

	it("offers nothing to do on a submitted request, and no way to decline", () => {
		render(<RequestedDocuments requests={[request()]} capability={capability} />);
		expect(screen.queryByRole("button", { name: /Upload|Submit|Cancel|Decline/u })).toBeNull();
	});
});
