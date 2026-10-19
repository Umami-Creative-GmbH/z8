/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentRequestAction } from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import type { ExpiringDocument } from "@/lib/personnel-file/expiry-store";
import { ExpiringDocumentsCard } from "./expiring-documents";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name: string) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		className,
	}: {
		href: string;
		children?: ReactNode;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
	useRouter: () => ({ refresh: nav.refresh }),
}));
vi.mock("@/components/ui/action-panel", () => {
	const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
	return {
		ActionPanel: ({ children, open }: { children?: ReactNode; open: boolean }) =>
			open ? <div role="dialog">{children}</div> : null,
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
	createDocumentRequestAction: vi.fn(),
}));

function expiring(overrides: Partial<ExpiringDocument>): ExpiringDocument {
	return {
		documentId: "document-1",
		employeeId: "employee-1",
		employeeName: "Anna Example",
		title: "First aid card 2024",
		category: "certificate",
		visibility: "shared",
		expiryDate: "2026-10-31",
		expiry: { status: "upcoming", days: 13 },
		renewalRequested: false,
		...overrides,
	} as ExpiringDocument;
}

const documents = [
	expiring({}),
	expiring({
		documentId: "document-2",
		employeeId: "employee-2",
		employeeName: "Ben Example",
		title: "Language course",
		category: "other",
		renewalRequested: true,
	}),
	expiring({
		documentId: "document-3",
		title: "Medical fitness",
		visibility: "hr_only",
	}),
];

function renderCard() {
	render(<ExpiringDocumentsCard documents={documents} leadDays={30} today="2026-10-18" />);
}

function rowOf(title: string): HTMLElement {
	const row = screen.getByText(title).closest("li");
	if (!row) throw new Error(`no row for ${title}`);
	return row;
}

beforeEach(() => {
	nav.refresh.mockReset();
	vi.mocked(toast.error).mockReset();
	vi.mocked(toast.success).mockReset();
	vi.mocked(createDocumentRequestAction).mockReset();
});

describe("requesting a renewal from Expiring documents", () => {
	it("links each row to the employee's file and offers a renewal only where none is requested", () => {
		renderCard();
		const first = rowOf("First aid card 2024");
		expect(within(first).getByRole("link", { name: /First aid card 2024/ })).toHaveProperty(
			"href",
			expect.stringContaining("/personnel-files/employee-1"),
		);
		expect(
			within(first).getByRole("button", {
				name: "Request a renewal of First aid card 2024 (Anna Example)",
			}),
		).toBeTruthy();

		const requested = rowOf("Language course");
		expect(within(requested).queryByRole("button", { name: /^Request a renewal of / })).toBeNull();
		expect(within(requested).getByText("Renewal requested")).toBeTruthy();
	});

	it("creates a request naming the renewed document, for its employee and category", async () => {
		vi.mocked(createDocumentRequestAction).mockResolvedValue({
			success: true,
			data: {} as never,
		});
		renderCard();
		fireEvent.click(
			within(rowOf("First aid card 2024")).getByRole("button", { name: /^Request a renewal of / }),
		);
		const dialog = screen.getByRole("dialog");
		expect(within(dialog).getByText("Request a renewal")).toBeTruthy();
		expect(within(dialog).getByText(/Renews First aid card 2024/)).toBeTruthy();

		fireEvent.change(within(dialog).getByRole("textbox", { name: /^Title/ }), {
			target: { value: "First aid card 2026" },
		});
		fireEvent.change(within(dialog).getByLabelText("Deadline picker"), {
			target: { value: "2026-10-30" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Request" }));

		await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
		expect(createDocumentRequestAction).toHaveBeenCalledWith({
			employeeId: "employee-1",
			category: "certificate",
			title: "First aid card 2026",
			note: "",
			deadline: "2026-10-30",
			renewedDocumentId: "document-1",
		});
	});

	it("warns that the employee never sees an HR-only renewed document", () => {
		renderCard();
		fireEvent.click(
			within(rowOf("Medical fitness")).getByRole("button", { name: /^Request a renewal of / }),
		);
		expect(
			within(screen.getByRole("dialog")).getByText(
				/This document is HR-only\. The employee does not see it/,
			),
		).toBeTruthy();
	});

	it("words a second request for the same document in the app language", async () => {
		vi.mocked(createDocumentRequestAction).mockResolvedValue({
			success: false,
			error: "Server wording",
			code: "renewal_already_requested",
		});
		renderCard();
		fireEvent.click(
			within(rowOf("First aid card 2024")).getByRole("button", { name: /^Request a renewal of / }),
		);
		const dialog = screen.getByRole("dialog");
		fireEvent.change(within(dialog).getByRole("textbox", { name: /^Title/ }), {
			target: { value: "First aid card 2026" },
		});
		fireEvent.change(within(dialog).getByLabelText("Deadline picker"), {
			target: { value: "2026-10-30" },
		});
		fireEvent.click(within(dialog).getByRole("button", { name: "Request" }));
		await waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"This document already has an open request for its renewal.",
			),
		);
		// The list is stale: it is reloaded.
		expect(nav.refresh).toHaveBeenCalledTimes(1);
	});
});
