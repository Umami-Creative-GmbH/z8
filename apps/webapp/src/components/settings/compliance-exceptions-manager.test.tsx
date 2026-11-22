/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	approveComplianceException,
	getPendingExceptions,
	rejectComplianceException,
} from "@/app/[locale]/(app)/settings/compliance/actions";
import { ComplianceExceptionsManager } from "./compliance-exceptions-manager";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? "")),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <div data-testid="avatar" />,
}));
vi.mock("@/app/[locale]/(app)/settings/compliance/actions", () => ({
	getPendingExceptions: vi.fn(),
	approveComplianceException: vi.fn(),
	rejectComplianceException: vi.fn(),
}));

function renderWithQuery(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const pendingException = {
	id: "exc-1",
	employeeId: "emp-1",
	organizationId: "org-1",
	exceptionType: "overtime_daily",
	reason: "Release incident",
	plannedDurationMinutes: 90,
	status: "pending",
	createdAt: new Date("2026-11-22T10:00:00.000Z"),
	employee: {
		id: "emp-1",
		userId: "user-1",
		firstName: "Ada",
		lastName: "Lovelace",
		user: { id: "user-1", name: "Ada Lovelace", email: "ada@example.com", image: null },
	},
};

describe("ComplianceExceptionsManager", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(getPendingExceptions).mockResolvedValue({
			success: true,
			data: [pendingException],
		} as never);
		vi.mocked(approveComplianceException).mockResolvedValue({ success: true } as never);
	});
	afterEach(cleanup);

	it("opens rejection in ActionPanel, validates length inline, preserves input on failure, and blocks duplicate submit", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		vi.mocked(rejectComplianceException).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}) as never,
		);

		renderWithQuery(
			<ComplianceExceptionsManager organizationId="org-1" employeeId="mgr-1" isAdmin />,
		);

		const rejectTrigger = await screen.findByRole("button", {
			name: "Reject Daily Overtime exception for Ada Lovelace",
		});
		await user.click(rejectTrigger);

		const dialog = screen.getByRole("dialog");
		expect(dialog.getAttribute("data-slot")).toBe("action-panel-content");

		const reasonInput = within(dialog).getByLabelText("Reason for rejection");
		fireEvent.change(reasonInput, { target: { value: "x".repeat(501) } });
		expect(await within(dialog).findByText("Reason must be 500 characters or fewer.")).toBeTruthy();
		await user.click(within(dialog).getByRole("button", { name: "Reject" }));
		expect(rejectComplianceException).not.toHaveBeenCalled();

		fireEvent.change(reasonInput, { target: { value: "Can wait until Monday" } });
		const submitButton = within(dialog).getByRole("button", { name: "Reject" });
		await user.click(submitButton);
		await waitFor(() => expect(rejectComplianceException).toHaveBeenCalledTimes(1));
		expect(within(dialog).getByRole("button", { name: "Rejecting…" })).toHaveProperty(
			"disabled",
			true,
		);
		fireEvent.submit(reasonInput.closest("form") as HTMLFormElement);
		expect(rejectComplianceException).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Network error" });
		await waitFor(() =>
			expect(within(dialog).getByRole("button", { name: "Reject" })).toHaveProperty(
				"disabled",
				false,
			),
		);
		expect((reasonInput as HTMLTextAreaElement).value).toBe("Can wait until Monday");
	});
});
