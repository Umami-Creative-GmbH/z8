// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EquipmentOfficers } from "./equipment-officers";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	refresh: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("sonner", () => ({
	toast: { success: api.success, error: api.error },
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipmentOfficerGrant: api.change,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh }),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
const employeeId = "15390000-0000-4000-8000-000000000001";
it("validates selected scope and submits a revisioned grant, then exposes explicit revocation", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	render(
		<EquipmentOfficers
			data={{
				grants: [],
				employees: [{ id: employeeId, name: "Alex Officer", current: true }],
				teams: [{ id: "team", name: "Operations" }],
			}}
		/>,
	);
	await user.selectOptions(
		screen.getByLabelText("Equipment officer"),
		employeeId,
	);
	await user.selectOptions(
		screen.getByLabelText("Responsibility scope"),
		"selected",
	);
	await user.click(screen.getByRole("button", { name: "Save responsibility" }));
	expect(
		await screen.findByText("Select at least one team or employee."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.click(screen.getByLabelText("Operations"));
	await user.click(screen.getByRole("button", { name: "Save responsibility" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "set_officer_grant",
				employeeId,
				scope: "selected",
				teamIds: ["team"],
				employeeIds: [],
				expectedRevision: 0,
				requestId: expect.any(String),
			}),
		),
	);
	await waitFor(() =>
		expect(api.success).toHaveBeenCalledWith("Equipment responsibility saved."),
	);
	expect(
		screen.queryByText("Select at least one team or employee."),
	).toBeNull();
});
it("revokes the displayed revision and refuses to offer former employees as new officers", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	render(
		<EquipmentOfficers
			data={{
				grants: [
					{
						employeeId,
						name: "Alex Officer",
						current: false,
						scope: "all",
						teamIds: [],
						employeeIds: [],
						revoked: false,
						revision: 4,
					},
				],
				employees: [{ id: employeeId, name: "Alex Officer", current: false }],
				teams: [],
			}}
		/>,
	);
	await user.selectOptions(
		screen.getByLabelText("Equipment officer"),
		employeeId,
	);
	expect(
		screen.queryByRole("button", { name: "Save responsibility" }),
	).toBeNull();
	await user.click(
		screen.getByRole("button", { name: "Revoke responsibility" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "revoke_officer_grant",
				employeeId,
				expectedRevision: 4,
			}),
		),
	);
	await waitFor(() =>
		expect(api.error).toHaveBeenCalledWith(expect.stringContaining("Reload")),
	);
});
