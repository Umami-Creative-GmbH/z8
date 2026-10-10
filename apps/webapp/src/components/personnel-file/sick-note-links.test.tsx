/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeDocumentView } from "@/lib/personnel-file/document-store";
import { LinkExistingSickNoteDialog, LinkSickNoteToAbsenceDialog } from "./sick-note-links";

const actions = vi.hoisted(() => ({
	linkSickNoteAction: vi.fn(),
	listSickLeaveForLinkingAction: vi.fn(),
	getPersonnelFileAction: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string, params?: Record<string, unknown>) =>
			(fallback ?? _key).replace(/\{(\w+)[^}]*\}/gu, (match, name: string) =>
				params && name in params ? String(params[name]) : match,
			),
	}),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/sick-note-actions", () => ({
	linkSickNoteAction: actions.linkSickNoteAction,
	listSickLeaveForLinkingAction: actions.listSickLeaveForLinkingAction,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/actions", () => ({
	getPersonnelFileAction: actions.getPersonnelFileAction,
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const document: EmployeeDocumentView = {
	id: "document-1",
	employeeId: "employee-1",
	category: "sick_note",
	title: "Doctor's note",
	documentDate: "2026-10-12",
	payPeriod: null,
	visibility: "hr_only",
	expiryDate: null,
	fileName: "note.pdf",
	mimeType: "application/pdf",
	sizeBytes: 10,
	createdAt: "2026-10-12T08:00:00.000Z",
	absence: null,
};

describe("LinkSickNoteToAbsenceDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.listSickLeaveForLinkingAction.mockResolvedValue({
			success: true,
			data: [
				{
					id: "absence-new",
					startDate: "2026-10-12",
					endDate: "2026-10-14",
					status: "approved",
					sickDetail: "without_certificate",
					sickNoteCount: 0,
				},
				{
					id: "absence-old",
					startDate: "2026-09-01",
					endDate: "2026-09-01",
					status: "pending",
					sickDetail: "with_certificate",
					sickNoteCount: 2,
				},
			],
		});
		actions.linkSickNoteAction.mockResolvedValue({ success: true, data: document });
	});

	it("links the sick note to the chosen sick leave of the employee", async () => {
		const onLinked = vi.fn();
		render(
			<LinkSickNoteToAbsenceDialog
				document={document}
				open
				onOpenChange={vi.fn()}
				onLinked={onLinked}
			/>,
			{ wrapper },
		);

		fireEvent.click(await screen.findByRole("radio", { name: /Sep 1, 2026/u }));
		fireEvent.click(screen.getByRole("button", { name: "Link" }));

		await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
		expect(actions.listSickLeaveForLinkingAction).toHaveBeenCalledWith("employee-1");
		expect(actions.linkSickNoteAction).toHaveBeenCalledWith({
			documentId: "document-1",
			absenceId: "absence-old",
		});
	});

	it("asks for an absence and shows the server's refusal", async () => {
		actions.linkSickNoteAction.mockResolvedValue({
			success: false,
			error: "Sick notes cannot be linked to a rejected absence.",
		});
		const onLinked = vi.fn();
		render(
			<LinkSickNoteToAbsenceDialog
				document={document}
				open
				onOpenChange={vi.fn()}
				onLinked={onLinked}
			/>,
			{ wrapper },
		);
		await screen.findAllByRole("radio");

		fireEvent.click(screen.getByRole("button", { name: "Link" }));
		expect(await screen.findByText("Choose an absence.")).toBeTruthy();
		expect(actions.linkSickNoteAction).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("radio", { name: /Oct 12/u }));
		fireEvent.click(screen.getByRole("button", { name: "Link" }));
		await waitFor(() =>
			expect(vi.mocked(toast).error).toHaveBeenCalledWith(
				"Sick notes cannot be linked to a rejected absence.",
			),
		);
		expect(onLinked).not.toHaveBeenCalled();
	});
});

describe("LinkExistingSickNoteDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.getPersonnelFileAction.mockResolvedValue({
			success: true,
			data: {
				capability: {},
				documents: [
					document,
					{
						...document,
						id: "document-linked",
						title: "Already linked",
						absence: { id: "absence-x", startDate: "2026-08-01", endDate: "2026-08-02" },
					},
				],
			},
		});
		actions.linkSickNoteAction.mockResolvedValue({ success: true, data: document });
	});

	it("offers only the employee's unlinked sick notes and links the chosen one", async () => {
		const onLinked = vi.fn();
		render(
			<LinkExistingSickNoteDialog
				absence={{
					id: "absence-1",
					employeeId: "employee-1",
					startDate: "2026-10-12",
					endDate: "2026-10-14",
				}}
				open
				onOpenChange={vi.fn()}
				onLinked={onLinked}
			/>,
			{ wrapper },
		);

		const radio = await screen.findByRole("radio", { name: /Doctor's note/u });
		expect(screen.queryByRole("radio", { name: /Already linked/u })).toBeNull();
		fireEvent.click(radio);
		fireEvent.click(screen.getByRole("button", { name: "Link" }));

		await waitFor(() => expect(onLinked).toHaveBeenCalledTimes(1));
		expect(actions.getPersonnelFileAction).toHaveBeenCalledWith({
			employeeId: "employee-1",
			category: "sick_note",
		});
		expect(actions.linkSickNoteAction).toHaveBeenCalledWith({
			documentId: "document-1",
			absenceId: "absence-1",
		});
	});
});
