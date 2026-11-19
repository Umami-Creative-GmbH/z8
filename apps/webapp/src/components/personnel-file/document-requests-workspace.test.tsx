// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
	type DocumentRequestsSnapshot,
	DocumentRequestsWorkspace,
} from "./document-requests-workspace";

const boundary = vi.hoisted(() => ({
	userId: "officer",
	organizationId: "org",
	employeeId: "self",
	pending: false,
	refresh: vi.fn(),
	push: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en-GB" }));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => ({
		userId: boundary.userId,
		activeOrganizationId: boundary.organizationId,
		employeeId: boundary.employeeId,
		isLoading: false,
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		isPending: boundary.pending,
		data: {
			user: { id: boundary.userId },
			session: { activeOrganizationId: boundary.organizationId },
		},
	}),
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ refresh: boundary.refresh, push: boundary.push }),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	createDocumentRequestsInBulkAction: vi.fn(),
	editDocumentRequestAction: vi.fn(),
	cancelDocumentRequestAction: vi.fn(),
	acceptDocumentRequestAction: vi.fn(),
	returnDocumentRequestAction: vi.fn(),
}));
function snapshot(): DocumentRequestsSnapshot {
	return {
		filters: { status: "active", overdue: false, page: 1, pageSize: 25 },
		pageCount: 2,
		today: "2026-11-15",
		timezone: "Pacific/Kiritimati",
		recipientOptions: {
			certificate: { employees: [{ id: "employee", name: "Ada Example" }], teams: [] },
			other: { employees: [], teams: [] },
		},
		rows: [
			{
				id: "request",
				employeeId: "employee",
				employeeName: "Ada Example",
				employeeNumber: "R047-2",
				isFormer: true,
				category: "certificate",
				title: "First aid",
				note: "Keep this evidence",
				deadline: "2026-11-01",
				status: "open",
				overdue: true,
				version: 3,
				renewedDocument: null,
				createdByName: "Officer",
				createdAt: "2026-10-01T10:00:00Z",
				history: [],
				submissions: [],
				pendingDocuments: [],
			},
		],
	};
}
const view = (data: DocumentRequestsSnapshot | null, key = "active") => (
	<DocumentRequestsWorkspace
		userId="officer"
		organizationId="org"
		employeeId="self"
		filterKey={key}
		snapshot={data}
	/>
);
beforeEach(() => {
	Object.assign(boundary, {
		userId: "officer",
		organizationId: "org",
		employeeId: "self",
		pending: false,
	});
	vi.clearAllMocks();
});
it("leads with scope and bulk creation and keeps employee/status/former context", () => {
	render(view(snapshot()));
	expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1);
	expect(screen.getByRole("button", { name: "Request from several" })).toBeTruthy();
	expect(screen.getByText("Personnel no. {number}")).toBeTruthy();
	expect(screen.getByText("Open")).toBeTruthy();
	expect(screen.getByText("Overdue")).toBeTruthy();
	expect(screen.getByText("Former employee")).toBeTruthy();
});
it("retains usable rows after a failed same-filter refresh, disables decisions, and retries the RSC owner", () => {
	const rendered = render(view(snapshot()));
	rendered.rerender(view(null));
	expect(screen.getByText("First aid")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Change {title}" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.refresh).toHaveBeenCalledTimes(1);
});
it("never presents a prior filter's retained records as a failed new page", () => {
	const rendered = render(view(snapshot()));
	rendered.rerender(view(null, "accepted"));
	expect(screen.queryByText("First aid")).toBeNull();
	expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
it.each(["userId", "organizationId", "employeeId"] as const)(
	"removes old records and tools after a %s change and requires a fresh arrival on ABA",
	(field) => {
		const data = snapshot(),
			rendered = render(view(data));
		boundary[field] = "changed";
		rendered.rerender(view(data));
		expect(screen.queryByText("First aid")).toBeNull();
		expect(screen.queryByRole("button", { name: "Request from several" })).toBeNull();
		boundary[field] = field === "userId" ? "officer" : field === "organizationId" ? "org" : "self";
		rendered.rerender(view(data));
		expect(screen.queryByText("First aid")).toBeNull();
		rendered.rerender(view(snapshot()));
		expect(screen.getByText("First aid")).toBeTruthy();
	},
);
it("keeps one heading and no sensitive records while checking the session", () => {
	boundary.pending = true;
	render(view(snapshot()));
	expect(screen.getAllByRole("heading", { level: 1 }).length).toBe(1);
	expect(screen.queryByText("First aid")).toBeNull();
});
it("refreshes cached Activity arrivals before exposing old targets", () => {
	const data = snapshot(),
		rendered = render(<Activity mode="visible">{view(data)}</Activity>);
	rendered.rerender(<Activity mode="hidden">{view(data)}</Activity>);
	rendered.rerender(<Activity mode="visible">{view(data)}</Activity>);
	expect(screen.queryByText("First aid")).toBeNull();
	expect(boundary.refresh).toHaveBeenCalled();
	rendered.rerender(<Activity mode="visible">{view(snapshot())}</Activity>);
	expect(screen.getByText("First aid")).toBeTruthy();
});

it("keeps a failed Activity arrival retryable until a successful read arrives", () => {
	const rendered = render(<Activity mode="visible">{view(null)}</Activity>);
	expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
	rendered.rerender(<Activity mode="hidden">{view(null)}</Activity>);
	rendered.rerender(<Activity mode="visible">{view(null)}</Activity>);
	expect(boundary.refresh).toHaveBeenCalledOnce();
	rendered.rerender(<Activity mode="visible">{view(null)}</Activity>);
	expect(screen.queryByText("First aid")).toBeNull();
	expect(screen.queryByRole("button", { name: "Request from several" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(boundary.refresh).toHaveBeenCalledTimes(2);
	rendered.rerender(<Activity mode="visible">{view(snapshot())}</Activity>);
	expect(screen.getByText("First aid")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Request from several" })).toBeTruthy();
});
