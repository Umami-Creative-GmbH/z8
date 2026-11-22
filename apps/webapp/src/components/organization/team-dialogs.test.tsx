/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTeam, updateTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import { CreateTeamDialog } from "./create-team-dialog";
import { EditTeamDialog } from "./edit-team-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	createTeam: vi.fn(),
	updateTeam: vi.fn(),
}));
vi.mock("@/components/employee-select", () => ({
	EmployeeSingleSelect: ({ label }: { label: string }) => <p>{label}</p>,
	toSelectableEmployee: (employee: unknown) => employee,
}));

function renderWithQuery(children: ReactNode) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

const existingTeam = {
	id: "team-1",
	organizationId: "org-1",
	name: "Platform",
	description: "Core services",
	primaryManagerId: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("CreateTeamDialog", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("renders in ActionPanel, validates empty name inline, preserves values on failure, and blocks duplicate submission", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		vi.mocked(createTeam).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}) as never,
		);

		renderWithQuery(
			<CreateTeamDialog organizationId="org-1" managerOptions={[]} open onOpenChange={vi.fn()} />,
		);

		expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("action-panel-content");

		await user.click(screen.getByRole("button", { name: "Create Team" }));
		expect(await screen.findByText("Team name is required")).toBeTruthy();
		expect(screen.getByLabelText(/Team Name/).getAttribute("aria-invalid")).toBe("true");
		expect(createTeam).not.toHaveBeenCalled();

		const nameInput = screen.getByLabelText(/Team Name/);
		const descriptionInput = screen.getByLabelText("Description (Optional)");
		await user.type(nameInput, "Field Ops");
		await user.type(descriptionInput, "Regional field engineers");

		const submitButton = screen.getByRole("button", { name: "Create Team" });
		await user.click(submitButton);
		await waitFor(() => expect(createTeam).toHaveBeenCalledTimes(1));
		expect(submitButton).toHaveProperty("disabled", true);
		fireEvent.submit(nameInput.closest("form") as HTMLFormElement);
		expect(createTeam).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Team already exists" });
		await waitFor(() => expect(submitButton).toHaveProperty("disabled", false));
		expect((nameInput as HTMLInputElement).value).toBe("Field Ops");
		expect((descriptionInput as HTMLTextAreaElement).value).toBe("Regional field engineers");
	});
});

describe("EditTeamDialog", () => {
	beforeEach(() => vi.clearAllMocks());
	afterEach(cleanup);

	it("validates cleared name inline, preserves edits on failure, and submits changed fields", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		vi.mocked(updateTeam)
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						finish = resolve;
					}) as never,
			)
			.mockResolvedValueOnce({
				success: true,
				data: { ...existingTeam, name: "Platform Engineering" },
			} as never);

		const onOpenChange = vi.fn();
		const onSuccess = vi.fn();

		renderWithQuery(
			<EditTeamDialog
				team={existingTeam}
				managerOptions={[]}
				open
				onOpenChange={onOpenChange}
				onSuccess={onSuccess}
			/>,
		);

		expect(screen.getByRole("dialog").getAttribute("data-slot")).toBe("action-panel-content");

		const nameInput = screen.getByLabelText(/Team Name/);
		await user.clear(nameInput);
		await user.click(screen.getByRole("button", { name: "Save Changes" }));
		expect(await screen.findByText("Team name is required")).toBeTruthy();
		expect(updateTeam).not.toHaveBeenCalled();

		await user.type(nameInput, "Platform Engineering");
		const saveButton = screen.getByRole("button", { name: "Save Changes" });
		await user.click(saveButton);
		await waitFor(() => expect(updateTeam).toHaveBeenCalledTimes(1));
		expect(saveButton).toHaveProperty("disabled", true);
		fireEvent.submit(nameInput.closest("form") as HTMLFormElement);
		expect(updateTeam).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Save failed" });
		await waitFor(() => expect(saveButton).toHaveProperty("disabled", false));
		expect((nameInput as HTMLInputElement).value).toBe("Platform Engineering");

		await user.click(saveButton);
		await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
		expect(updateTeam).toHaveBeenLastCalledWith({
			teamId: "team-1",
			name: "Platform Engineering",
			description: undefined,
			primaryManagerId: undefined,
		});
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});
});
