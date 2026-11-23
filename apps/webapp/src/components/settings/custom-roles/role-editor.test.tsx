/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomRoleWithPermissions } from "@/lib/effect/services/custom-role.service";
import { CustomRolesManagement } from "./custom-roles-management";
import { RoleEditor } from "./role-editor";

const actions = vi.hoisted(() => ({
	listCustomRoles: vi.fn(async () => ({ success: true, data: [] })),
	deleteCustomRole: vi.fn(async () => ({ success: true })),
	createCustomRole: vi.fn(),
	updateCustomRole: vi.fn(async () => ({ success: true })),
	setRolePermissions: vi.fn(async () => ({ success: true })),
}));
vi.mock("@/app/[locale]/(app)/settings/roles/actions", () => actions);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const role: CustomRoleWithPermissions = {
	id: "role-1",
	organizationId: "org-1",
	name: "Accounting",
	description: null,
	color: "#6366f1",
	isActive: true,
	baseTier: "employee",
	createdAt: new Date("2026-10-01T00:00:00.000Z"),
	createdBy: "user-1",
	updatedAt: new Date("2026-10-01T00:00:00.000Z"),
	updatedBy: null,
	permissions: [
		{ action: "read", subject: "Report" },
		{ action: "read", subject: "TravelExpenseFinance" },
	],
	assignedCount: 1,
};

describe("RoleEditor", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		actions.updateCustomRole.mockResolvedValue({ success: true });
		actions.setRolePermissions.mockResolvedValue({ success: true });
	});

	afterEach(cleanup);

	it("drops stored permissions the registry no longer offers when saving (#748)", async () => {
		const onSaved = vi.fn();
		render(<RoleEditor role={role} onSaved={onSaved} onCancel={vi.fn()} />);

		fireEvent.click(screen.getByRole("button", { name: /save/i }));

		await waitFor(() => expect(onSaved).toHaveBeenCalled());
		expect(actions.setRolePermissions).toHaveBeenCalledWith({
			roleId: "role-1",
			permissions: [{ action: "read", subject: "Report" }],
		});
	});

	it("shows an accessible inline validation error when role name is blank", async () => {
		const user = userEvent.setup();
		render(<RoleEditor onSaved={vi.fn()} onCancel={vi.fn()} />);

		await user.click(screen.getByRole("button", { name: "Create Role" }));

		expect(await screen.findByText("Role name is required")).toBeTruthy();
		expect(screen.getByLabelText(/^Name/).getAttribute("aria-invalid")).toBe("true");
		expect(actions.createCustomRole).not.toHaveBeenCalled();
	});

	it("preserves entered values on failure and blocks duplicate submissions while pending", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		actions.createCustomRole.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		render(<RoleEditor onSaved={vi.fn()} onCancel={vi.fn()} />);

		const nameInput = screen.getByLabelText(/^Name/);
		const descriptionInput = screen.getByLabelText("Description");
		await user.type(nameInput, "Payroll Auditor");
		await user.type(descriptionInput, "Reviews payroll balances");

		const submitButton = screen.getByRole("button", { name: "Create Role" });
		await user.click(submitButton);
		await waitFor(() => expect(actions.createCustomRole).toHaveBeenCalledTimes(1));
		expect(submitButton).toHaveProperty("disabled", true);
		fireEvent.submit(nameInput.closest("form") as HTMLFormElement);
		expect(actions.createCustomRole).toHaveBeenCalledTimes(1);

		finish({ success: false, error: "Role name already exists" });
		await waitFor(() => expect(submitButton).toHaveProperty("disabled", false));
		expect((nameInput as HTMLInputElement).value).toBe("Payroll Auditor");
		expect((descriptionInput as HTMLTextAreaElement).value).toBe("Reviews payroll balances");
	});

	it("blocks dismissing the host ActionPanel while RoleEditor is saving", async () => {
		const user = userEvent.setup();
		let finish!: (value: { success: false; error: string }) => void;
		actions.listCustomRoles.mockResolvedValueOnce({ success: true, data: [role] });
		actions.createCustomRole.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);

		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<CustomRolesManagement organizationId="org-1" />
			</QueryClientProvider>,
		);

		await user.click(await screen.findByRole("button", { name: "Create Role" }));
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();

		await user.type(screen.getByLabelText(/^Name/), "Temp Role");
		await user.click(screen.getAllByRole("button", { name: "Create Role" }).at(-1)!);
		await waitFor(() => expect(actions.createCustomRole).toHaveBeenCalledTimes(1));

		// Close button is hidden and Escape cannot dismiss while saving
		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
		await user.keyboard("{Escape}");
		expect(screen.getByRole("dialog")).toBeTruthy();

		// Once settled, close button returns and dismissal works again
		finish({ success: false, error: "Temporary failure" });
		await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBeTruthy());
	});
});
