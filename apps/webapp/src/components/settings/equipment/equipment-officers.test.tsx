// @vitest-environment jsdom
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { EquipmentOfficerView } from "@/lib/organization/equipment/contracts";
import { EquipmentOfficers } from "./equipment-officers";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipmentOfficerGrant: api.change,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh }),
}));
vi.mock("sonner", () => ({
	toast: { success: api.toastSuccess, error: api.toastError },
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replace(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const employeeId = "15390000-0000-4000-8000-000000000001";
const otherId = "15390000-0000-4000-8000-000000000002";
const teamId = "15390000-0000-4000-8000-0000000000a1";

it("validates the selected scope in the action panel and submits a revisioned grant", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	render(
		<EquipmentOfficers
			data={{
				grants: [],
				employees: [{ id: employeeId, name: "Alex Officer", current: true }],
				teams: [{ id: teamId, name: "Operations" }],
			}}
		/>,
	);
	expect(screen.getByText("No equipment officers yet")).toBeTruthy();
	await user.click(
		screen.getByRole("button", { name: "Add equipment officer" }),
	);
	const panel = await screen.findByRole("dialog", {
		name: "Add equipment officer",
	});
	await user.click(
		within(panel).getByRole("button", { name: "Save responsibility" }),
	);
	expect(
		await within(panel).findByText("Select an equipment officer."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();

	await user.click(
		within(panel).getByRole("combobox", { name: "Equipment officer" }),
	);
	await user.click(await screen.findByRole("option", { name: "Alex Officer" }));
	await user.click(
		within(panel).getByRole("combobox", { name: "Responsibility scope" }),
	);
	await user.click(
		await screen.findByRole("option", { name: "Selected teams and employees" }),
	);
	await user.click(
		within(panel).getByRole("button", { name: "Save responsibility" }),
	);
	expect(
		await within(panel).findByText("Select at least one team or employee."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();

	await user.click(within(panel).getByRole("checkbox", { name: "Operations" }));
	await user.click(
		within(panel).getByRole("button", { name: "Save responsibility" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "set_officer_grant",
			employeeId,
			scope: "selected",
			teamIds: [teamId],
			employeeIds: [],
			expectedRevision: 0,
			requestId: expect.any(String),
		}),
	);
	expect(api.toastSuccess).toHaveBeenCalledWith(
		"Equipment responsibility saved.",
	);
	expect(api.refresh).toHaveBeenCalled();
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("cancels the officer panel without sending a command", async () => {
	const user = userEvent.setup();
	render(
		<EquipmentOfficers
			data={{
				grants: [],
				employees: [{ id: employeeId, name: "Alex Officer", current: true }],
				teams: [],
			}}
		/>,
	);
	await user.click(
		screen.getByRole("button", { name: "Add equipment officer" }),
	);
	const panel = await screen.findByRole("dialog", {
		name: "Add equipment officer",
	});
	await user.click(within(panel).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(api.change).not.toHaveBeenCalled();
});

it("edits an active grant with its current scope and revision", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	const data: EquipmentOfficerView = {
		grants: [
			{
				employeeId,
				name: "Alex Officer",
				current: true,
				scope: "selected",
				teamIds: [teamId],
				employeeIds: [],
				revoked: false,
				revision: 3,
			},
		],
		employees: [
			{ id: employeeId, name: "Alex Officer", current: true },
			{ id: otherId, name: "Sam Field", current: true },
		],
		teams: [{ id: teamId, name: "Operations" }],
	};
	render(<EquipmentOfficers data={data} />);
	const row = screen.getByText("Alex Officer").closest("tr") as HTMLElement;
	expect(within(row).getByText("Operations")).toBeTruthy();
	await user.click(
		screen.getByRole("button", { name: "Actions for officer Alex Officer" }),
	);
	await user.click(await screen.findByRole("menuitem", { name: "Edit" }));
	const panel = await screen.findByRole("dialog", {
		name: "Edit equipment officer",
	});
	expect(
		within(panel).queryByRole("combobox", { name: "Equipment officer" }),
	).toBeNull();
	expect(
		within(panel)
			.getByRole("checkbox", { name: "Operations" })
			.getAttribute("aria-checked"),
	).toBe("true");
	await user.click(within(panel).getByRole("checkbox", { name: "Sam Field" }));
	await user.click(
		within(panel).getByRole("button", { name: "Save responsibility" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "set_officer_grant",
			employeeId,
			scope: "selected",
			teamIds: [teamId],
			employeeIds: [otherId],
			expectedRevision: 3,
			requestId: expect.any(String),
		}),
	);
});

it("revokes the displayed revision after confirmation and refuses to offer former employees as new officers", async () => {
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
	expect(screen.getByText("Former employee")).toBeTruthy();
	expect(screen.getByText("Whole organization")).toBeTruthy();
	// Nobody current is left to add, so the panel cannot offer the former employee.
	expect(
		screen.getByRole("button", { name: "Add equipment officer" }),
	).toHaveProperty("disabled", true);

	await user.click(
		screen.getByRole("button", { name: "Actions for officer Alex Officer" }),
	);
	expect(await screen.findByRole("menuitem", { name: "Revoke" })).toBeTruthy();
	expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
	await user.click(screen.getByRole("menuitem", { name: "Revoke" }));
	const dialog = await screen.findByRole("alertdialog");
	expect(dialog.textContent).toContain("Alex Officer");
	await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(api.change).not.toHaveBeenCalled();

	await user.click(
		screen.getByRole("button", { name: "Actions for officer Alex Officer" }),
	);
	await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
	await user.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Revoke responsibility",
		}),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "revoke_officer_grant",
			employeeId,
			expectedRevision: 4,
			requestId: expect.any(String),
		}),
	);
	await waitFor(() => expect(api.toastError).toHaveBeenCalled());
	expect(api.toastError.mock.calls[0][0]).toContain("Reload");
	expect(api.refresh).not.toHaveBeenCalled();
	// A refused revocation keeps the confirmation open for a retry.
	const dialogAgain = screen.getByRole("alertdialog");
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	await user.click(
		within(dialogAgain).getByRole("button", { name: "Revoke responsibility" }),
	);
	await waitFor(() =>
		expect(api.toastSuccess).toHaveBeenCalledWith(
			"Equipment responsibility revoked.",
		),
	);
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.refresh).toHaveBeenCalled();
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
});

it("offers a re-grant of a revoked officer from its stored revision", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	render(
		<EquipmentOfficers
			data={{
				grants: [
					{
						employeeId,
						name: "Alex Officer",
						current: true,
						scope: "all",
						teamIds: [],
						employeeIds: [],
						revoked: true,
						revision: 6,
					},
				],
				employees: [{ id: employeeId, name: "Alex Officer", current: true }],
				teams: [],
			}}
		/>,
	);
	expect(screen.getByText("No equipment officers yet")).toBeTruthy();
	await user.click(
		screen.getByRole("button", { name: "Add equipment officer" }),
	);
	const panel = await screen.findByRole("dialog", {
		name: "Add equipment officer",
	});
	await user.click(
		within(panel).getByRole("combobox", { name: "Equipment officer" }),
	);
	await user.click(await screen.findByRole("option", { name: "Alex Officer" }));
	await user.click(
		within(panel).getByRole("button", { name: "Save responsibility" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "set_officer_grant",
			employeeId,
			scope: "all",
			teamIds: [],
			employeeIds: [],
			expectedRevision: 6,
			requestId: expect.any(String),
		}),
	);
});
