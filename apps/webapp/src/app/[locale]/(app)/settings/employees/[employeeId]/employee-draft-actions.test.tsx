/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query";
import { EmployeeDraftActions } from "./employee-draft-actions";

const {
	deleteEmployeeInvitationDraftMock,
	pushMock,
	resendInvitationMock,
	toastErrorMock,
} = vi.hoisted(() => ({
	deleteEmployeeInvitationDraftMock: vi.fn(),
	pushMock: vi.fn(),
	resendInvitationMock: vi.fn(),
	toastErrorMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback?: string) => fallback ?? _key,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: vi.fn(),
	},
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	resendInvitation: resendInvitationMock,
}));

vi.mock("@/app/[locale]/(app)/settings/employees/actions", () => ({
	deleteEmployeeInvitationDraft: deleteEmployeeInvitationDraftMock,
}));

const props = {
	organizationId: "org-1",
	encodedDraftEmployeeId: "draft:draft-1",
	invitationId: "invitation-1",
	invitationStatus: "pending",
};

function renderWithQueryClient(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
	const removeQueries = vi.spyOn(queryClient, "removeQueries");

	return {
		...render(
			<QueryClientProvider client={queryClient}>
				{children}
			</QueryClientProvider>,
		),
		invalidateQueries,
		removeQueries,
	};
}

function renderActions(overrides: Partial<typeof props> = {}) {
	return renderWithQueryClient(
		<EmployeeDraftActions {...props} {...overrides} />,
	);
}

function openDeleteDialog() {
	fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
	return screen.getByRole("alertdialog");
}

describe("EmployeeDraftActions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resendInvitationMock.mockResolvedValue({ success: true });
		deleteEmployeeInvitationDraftMock.mockResolvedValue({ success: true });
	});

	it("renders the invitation draft actions", () => {
		renderActions();

		expect(
			screen.getByRole("button", { name: "Resend invitation" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete draft" })).toBeTruthy();
	});

	it.each([
		"accepted",
		"canceled",
		"rejected",
	])("renders no controls for a %s invitation", (invitationStatus) => {
		renderActions({ invitationStatus });

		expect(
			screen.queryByRole("button", { name: "Resend invitation" }),
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
	});

	it("resends the invitation and invalidates its organization and detail queries", async () => {
		const { invalidateQueries } = renderActions();

		fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }));

		await waitFor(() => {
			expect(resendInvitationMock).toHaveBeenCalledWith(
				"org-1",
				"invitation-1",
			);
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.invitations.list("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.detail("draft:draft-1"),
			});
		});
	});

	it.each([
		[
			"resolved",
			{ success: false, error: "postgres://admin:secret@internal/invitations" },
		],
		["thrown", new Error("Bearer secret-resend-token")],
	])("reports a %s resend failure and keeps the actions available", async (_kind, failure) => {
		if (failure instanceof Error) {
			resendInvitationMock.mockRejectedValue(failure);
		} else {
			resendInvitationMock.mockResolvedValue(failure);
		}
		const { invalidateQueries } = renderActions();

		fireEvent.click(screen.getByRole("button", { name: "Resend invitation" }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith(
				"Failed to resend invitation",
			);
		});
		const secret = failure instanceof Error ? failure.message : failure.error;
		expect(toastErrorMock).not.toHaveBeenCalledWith(secret);
		expect(document.body.textContent).not.toContain(secret);
		expect(
			screen.getByRole("button", { name: "Resend invitation" }),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Delete draft" })).toBeTruthy();
		expect(invalidateQueries).not.toHaveBeenCalled();
	});

	it("opens an accessible confirmation that explains exactly what deletion affects", () => {
		renderActions();

		const dialog = openDeleteDialog();

		expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
		expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Delete employee draft?" }),
		).toBeTruthy();
		expect(
			screen.getByText(
				"This permanently deletes the prepared employee data and cancels the pending invitation. No employee history will be deleted.",
			),
		).toBeTruthy();
	});

	it("deletes by encoded id, updates caches, and returns through localized navigation", async () => {
		const { invalidateQueries, removeQueries } = renderActions();
		openDeleteDialog();

		fireEvent.click(
			screen.getByRole("button", { name: "Delete draft permanently" }),
		);

		await waitFor(() => {
			expect(deleteEmployeeInvitationDraftMock).toHaveBeenCalledWith(
				"draft:draft-1",
			);
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.invitations.list("org-1"),
			});
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.organization("org-1"),
			});
			expect(removeQueries).toHaveBeenCalledWith({
				queryKey: queryKeys.employees.detail("draft:draft-1"),
				exact: true,
			});
			expect(pushMock).toHaveBeenCalledWith("/settings/employees");
		});
	});

	it.each([
		[
			"resolved",
			{ success: false, error: "postgres://admin:secret@internal/drafts" },
		],
		["thrown", new Error("Bearer secret-delete-token")],
	])("reports a %s deletion failure and leaves the confirmation open", async (_kind, failure) => {
		if (failure instanceof Error) {
			deleteEmployeeInvitationDraftMock.mockRejectedValue(failure);
		} else {
			deleteEmployeeInvitationDraftMock.mockResolvedValue(failure);
		}
		const { invalidateQueries, removeQueries } = renderActions();
		openDeleteDialog();

		fireEvent.click(
			screen.getByRole("button", { name: "Delete draft permanently" }),
		);

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith(
				"Failed to delete employee draft",
			);
		});
		const secret = failure instanceof Error ? failure.message : failure.error;
		expect(toastErrorMock).not.toHaveBeenCalledWith(secret);
		expect(document.body.textContent).not.toContain(secret);
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect(invalidateQueries).not.toHaveBeenCalled();
		expect(removeQueries).not.toHaveBeenCalled();
		expect(pushMock).not.toHaveBeenCalled();
	});

	it("disables both actions and prevents duplicate resend dispatch while pending", async () => {
		let resolveResend!: (result: { success: true }) => void;
		resendInvitationMock.mockReturnValue(
			new Promise((resolve) => {
				resolveResend = resolve;
			}),
		);
		renderActions();
		const resendButton = screen.getByRole("button", {
			name: "Resend invitation",
		});

		fireEvent.click(resendButton);
		await waitFor(() => expect(resendInvitationMock).toHaveBeenCalledOnce());

		const pendingResendButton = screen.getByRole("button", {
			name: "Resending invitation...",
		});
		expect(pendingResendButton).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Delete draft" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(
			pendingResendButton
				.querySelector(".animate-spin")
				?.getAttribute("aria-hidden"),
		).toBe("true");
		fireEvent.click(pendingResendButton);
		expect(resendInvitationMock).toHaveBeenCalledOnce();

		await act(async () => resolveResend({ success: true }));
	});

	it("disables confirmation controls and prevents duplicate deletion while pending", async () => {
		let resolveDelete!: (result: { success: true }) => void;
		deleteEmployeeInvitationDraftMock.mockReturnValue(
			new Promise((resolve) => {
				resolveDelete = resolve;
			}),
		);
		renderActions();
		openDeleteDialog();
		const confirmButton = screen.getByRole("button", {
			name: "Delete draft permanently",
		});

		fireEvent.click(confirmButton);
		await waitFor(() =>
			expect(deleteEmployeeInvitationDraftMock).toHaveBeenCalledOnce(),
		);

		const pendingDeleteButton = screen.getByRole("button", {
			name: "Deleting draft...",
		});
		expect(pendingDeleteButton).toHaveProperty("disabled", true);
		expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty(
			"disabled",
			true,
		);
		expect(
			pendingDeleteButton
				.querySelector(".animate-spin")
				?.getAttribute("aria-hidden"),
		).toBe("true");
		fireEvent.click(pendingDeleteButton);
		expect(deleteEmployeeInvitationDraftMock).toHaveBeenCalledOnce();

		await act(async () => resolveDelete({ success: true }));
	});
});
