/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInviteCode,
	generateRandomCode,
	updateInviteCode,
} from "@/app/[locale]/(app)/settings/organization/invite-code-actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { InviteCodeDialog } from "./invite-code-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/organization/invite-code-actions", () => ({
	createInviteCode: vi.fn(),
	generateRandomCode: vi.fn(),
	updateInviteCode: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	listTeams: vi.fn(),
}));

function renderWithQuery(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

describe("InviteCodeDialog", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(listTeams).mockResolvedValue({ success: true, data: [] } as never);
		vi.mocked(generateRandomCode).mockResolvedValue({ success: true, data: "TEAM-1234" } as never);
	});

	afterEach(cleanup);

	it("renders in ActionPanel, validates label/code/maxUses inline, preserves values on failure, and blocks duplicate submission", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		vi.mocked(createInviteCode).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}) as never,
		);

		renderWithQuery(
			<InviteCodeDialog
				organizationId="org-1"
				minExpiryDate="2026-11-23"
				open
				onOpenChange={vi.fn()}
			/>,
		);

		expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("action-panel-content");

		const codeInput = screen.getByLabelText("Code");
		const maxUsesInput = screen.getByLabelText("Maximum Uses");
		await user.type(codeInput, "AB!");
		await user.type(maxUsesInput, "0");
		await user.click(screen.getByRole("button", { name: "Create" }));

		expect(await screen.findByText("Label is required")).toBeTruthy();
		expect(
			screen.getByText("Use 4-20 characters: letters, numbers, and hyphens only."),
		).toBeTruthy();
		expect(screen.getByText("Enter a whole number of at least 1.")).toBeTruthy();
		expect(createInviteCode).not.toHaveBeenCalled();

		await user.clear(codeInput);
		await user.type(codeInput, "SPRING-2026");
		const labelInput = screen.getByLabelText(/Label/);
		await user.type(labelInput, "Spring Hires");
		await user.clear(maxUsesInput);
		await user.type(maxUsesInput, "25");

		const submitButton = screen.getByRole("button", { name: "Create" });
		await user.click(submitButton);
		await waitFor(() => expect(createInviteCode).toHaveBeenCalledTimes(1));
		expect(submitButton).toHaveProperty("disabled", true);
		fireEvent.submit(labelInput.closest("form") as HTMLFormElement);
		expect(createInviteCode).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Code already exists" });
		await waitFor(() => expect(submitButton).toHaveProperty("disabled", false));
		expect((codeInput as HTMLInputElement).value).toBe("SPRING-2026");
		expect((labelInput as HTMLInputElement).value).toBe("Spring Hires");
		expect((maxUsesInput as HTMLInputElement).value).toBe("25");
	});

	it("updates an existing invite code", async () => {
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		vi.mocked(updateInviteCode).mockResolvedValueOnce({ success: true, data: {} } as never);

		renderWithQuery(
			<InviteCodeDialog
				organizationId="org-1"
				minExpiryDate="2026-11-23"
				inviteCode={{
					id: "invite-1",
					organizationId: "org-1",
					code: "EXISTING-1",
					label: "Old Label",
					description: "Old description",
					maxUses: 10,
					currentUses: 2,
					expiresAt: null,
					defaultTeamId: null,
					requiresApproval: true,
					status: "active",
					createdAt: new Date("2026-01-01T00:00:00.000Z"),
					createdBy: "user-1",
					updatedAt: new Date("2026-01-01T00:00:00.000Z"),
					defaultTeam: null,
					createdByUser: { id: "user-1", name: "Admin", email: "admin@example.com" },
				}}
				open
				onOpenChange={onOpenChange}
			/>,
		);

		const labelInput = screen.getByLabelText(/Label/);
		await user.clear(labelInput);
		await user.type(labelInput, "Updated Label");
		await user.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => expect(updateInviteCode).toHaveBeenCalledTimes(1));
		expect(updateInviteCode).toHaveBeenCalledWith(
			expect.objectContaining({
				inviteCodeId: "invite-1",
				label: "Updated Label",
				maxUses: 10,
				defaultTeamId: null,
			}),
		);
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("generates a fresh invite code each time the create panel reopens", async () => {
		vi.mocked(generateRandomCode)
			.mockResolvedValueOnce({ success: true, data: "FIRST-1111" } as never)
			.mockResolvedValueOnce({ success: true, data: "SECOND-2222" } as never);

		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		const onOpenChange = vi.fn();

		const { rerender } = render(
			<QueryClientProvider client={queryClient}>
				<InviteCodeDialog
					organizationId="org-1"
					minExpiryDate="2026-11-23"
					open
					onOpenChange={onOpenChange}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe("FIRST-1111"),
		);

		rerender(
			<QueryClientProvider client={queryClient}>
				<InviteCodeDialog
					organizationId="org-1"
					minExpiryDate="2026-11-23"
					open={false}
					onOpenChange={onOpenChange}
				/>
			</QueryClientProvider>,
		);

		rerender(
			<QueryClientProvider client={queryClient}>
				<InviteCodeDialog
					organizationId="org-1"
					minExpiryDate="2026-11-23"
					open
					onOpenChange={onOpenChange}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() =>
			expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe("SECOND-2222"),
		);
		expect(generateRandomCode).toHaveBeenCalledTimes(2);
	});
});
