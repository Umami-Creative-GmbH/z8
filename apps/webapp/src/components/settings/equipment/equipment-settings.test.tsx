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
import type { EquipmentSetupView } from "@/lib/organization/equipment/contracts";
import { EquipmentSettings } from "./equipment-settings";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	read: vi.fn(),
	detail: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipmentSetup: api.change,
	getEquipmentSetup: api.read,
	getEquipmentSetupDetail: api.detail,
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

const laptopType = {
	id: "15360000-0000-4000-8000-000000000010",
	name: "Laptop",
	trackingMode: "individual",
	defaultReturnRequired: true,
	used: true,
	archived: false,
	revision: 2,
} as const;
const configured: EquipmentSetupView = {
	items: [],
	policy: { retentionMonths: 24, revision: 1 },
	types: [laptopType],
	selectableTypes: [laptopType],
};
const empty: EquipmentSetupView = {
	policy: null,
	types: [],
	selectableTypes: [],
	items: [],
};

async function openRowAction(
	user: ReturnType<typeof userEvent.setup>,
	menu: string,
	action: string,
) {
	await user.click(screen.getByRole("button", { name: menu }));
	await user.click(await screen.findByRole("menuitem", { name: action }));
}

it("does not label a held identity as available for another assignment", () => {
	render(
		<EquipmentSettings
			initialData={{
				...configured,
				items: [
					{
						id: "15370000-0000-4000-8000-000000000020",
						typeId: laptopType.id,
						identifier: "L-01",
						serialNumber: null,
						status: "available",
						inCustody: true,
						archived: false,
						revision: 2,
					},
				],
			}}
		/>,
	);
	const row = screen.getByText("L-01").closest("tr");
	expect(row).toBeTruthy();
	expect(
		within(row as HTMLElement).getByText(
			"Held by employee; unavailable for new issuance",
		),
	).toBeTruthy();
	expect(within(row as HTMLElement).queryByText("Available")).toBeNull();
});

it("registers an item in an action panel, reports refusals as toasts, and preserves request identity for retry", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "identifier_taken" },
	});
	render(<EquipmentSettings initialData={configured} />);
	expect(screen.queryByRole("dialog")).toBeNull();
	await user.click(screen.getByRole("button", { name: "Register item" }));
	const panel = await screen.findByRole("dialog", {
		name: "Register equipment item",
	});
	await user.click(
		within(panel).getByRole("combobox", { name: "Equipment type" }),
	);
	await user.click(await screen.findByRole("option", { name: "Laptop" }));
	await user.type(within(panel).getByLabelText("Equipment identifier"), "L-01");
	await user.type(
		within(panel).getByLabelText("Manufacturer serial number (optional)"),
		"SN-42",
	);
	await user.click(
		within(panel).getByRole("button", { name: "Register item" }),
	);
	await waitFor(() =>
		expect(api.toastError).toHaveBeenCalledWith(
			"This equipment identifier is already reserved, including archived and retired items.",
		),
	);
	// A refusal keeps the panel open with the entered values for correction or retry.
	expect(
		screen.getByRole("dialog", { name: "Register equipment item" }),
	).toBeTruthy();
	await user.click(
		within(panel).getByRole("button", { name: "Register item" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.change.mock.calls[0][0]).toEqual({
		kind: "register_item",
		requestId: expect.any(String),
		typeId: laptopType.id,
		identifier: "L-01",
		serialNumber: "SN-42",
	});
});

it("validates the item panel before sending a command", async () => {
	const user = userEvent.setup();
	render(<EquipmentSettings initialData={configured} />);
	await user.click(screen.getByRole("button", { name: "Register item" }));
	const panel = await screen.findByRole("dialog", {
		name: "Register equipment item",
	});
	await user.click(
		within(panel).getByRole("button", { name: "Register item" }),
	);
	expect(
		await within(panel).findByText(
			"Select an active individually tracked type.",
		),
	).toBeTruthy();
	expect(
		within(panel).getByText(
			"Enter an equipment identifier of up to 100 characters.",
		),
	).toBeTruthy();
	expect(document.activeElement).toBe(
		within(panel).getByRole("combobox", { name: "Equipment type" }),
	);
	expect(api.change).not.toHaveBeenCalled();
});

it("requires confirmation in an alert dialog before archiving a type", async () => {
	const user = userEvent.setup();
	render(<EquipmentSettings initialData={configured} />);
	await openRowAction(user, "Actions for type Laptop", "Archive");
	const dialog = await screen.findByRole("alertdialog");
	expect(dialog.textContent).toContain("Laptop");
	expect(api.change).not.toHaveBeenCalled();
	await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(api.change).not.toHaveBeenCalled();

	api.change.mockResolvedValue({ success: false, error: "offline" });
	await openRowAction(user, "Actions for type Laptop", "Archive");
	await user.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Confirm archive",
		}),
	);
	await waitFor(() =>
		expect(api.toastError).toHaveBeenCalledWith(
			"Equipment setup is unavailable. Check your organization access and try again.",
		),
	);

	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: laptopType.id, revision: 3 },
	});
	api.read.mockResolvedValue({
		success: true,
		data: {
			...configured,
			types: [{ ...laptopType, archived: true }],
			selectableTypes: [],
		},
	});
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	await openRowAction(user, "Actions for type Laptop", "Archive");
	await user.click(
		within(await screen.findByRole("alertdialog")).getByRole("button", {
			name: "Confirm archive",
		}),
	);
	await waitFor(() =>
		expect(api.toastSuccess).toHaveBeenCalledWith("Equipment type archived."),
	);
	expect(api.change).toHaveBeenCalledTimes(2);
	expect(api.change.mock.calls[0][0]).toEqual({
		kind: "archive_type",
		requestId: expect.any(String),
		id: laptopType.id,
		expectedRevision: 2,
	});
	// Retrying the archive of the same revision keeps its request identity.
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	// Archived types are hidden until the archived filter is on.
	await waitFor(() =>
		expect(screen.getByText("No active equipment types")).toBeTruthy(),
	);
	await user.click(
		screen.getByRole("switch", { name: "Show archived records" }),
	);
	expect(screen.getByText("Laptop")).toBeTruthy();
	expect(screen.getByText("Archived")).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: "Actions for type Laptop" }),
	).toBeNull();
});

it("loads current type detail before editing and preserves the mode of a used type", async () => {
	const user = userEvent.setup();
	api.detail.mockResolvedValue({
		success: true,
		data: { kind: "type", record: { ...laptopType, revision: 7 } },
	});
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: laptopType.id, revision: 8 },
	});
	api.read.mockResolvedValue({ success: true, data: configured });
	render(
		<EquipmentSettings
			initialData={{
				...configured,
				types: [{ ...laptopType, used: false, revision: 1 }],
			}}
		/>,
	);
	await openRowAction(user, "Actions for type Laptop", "Edit");
	const panel = await screen.findByRole("dialog", {
		name: "Edit equipment type",
	});
	expect(api.detail).toHaveBeenCalledWith({ kind: "type", id: laptopType.id });
	expect(
		within(panel).getByRole("combobox", { name: "Tracking mode" }),
	).toHaveProperty("disabled", true);
	expect(within(panel).getByLabelText("Type name")).toHaveProperty(
		"value",
		"Laptop",
	);
	await user.click(
		within(panel).getByRole("switch", { name: "Return required by default" }),
	);
	await user.click(within(panel).getByRole("button", { name: "Save type" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "update_type",
			requestId: expect.any(String),
			id: laptopType.id,
			expectedRevision: 7,
			name: "Laptop",
			trackingMode: "individual",
			defaultReturnRequired: false,
		}),
	);
	expect(api.toastSuccess).toHaveBeenCalledWith("Equipment type saved.");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("explains empty setup and blocks registration until retention and an individual type exist", () => {
	render(<EquipmentSettings initialData={empty} />);
	expect(screen.getByText("Retention is not configured yet")).toBeTruthy();
	expect(
		screen.getByRole("button", { name: "Configure retention" }),
	).toBeTruthy();
	expect(screen.getByText("No equipment types yet")).toBeTruthy();
	expect(screen.getByRole("button", { name: "Add type" })).toHaveProperty(
		"disabled",
		false,
	);
	expect(screen.getByText("No identified items yet")).toBeTruthy();
	const register = screen.getByRole("button", { name: "Register item" });
	expect(register).toHaveProperty("disabled", true);
	expect(register.getAttribute("aria-describedby")).toBeTruthy();
	expect(
		document.getElementById(register.getAttribute("aria-describedby") ?? "")
			?.textContent,
	).toBe(
		"Configure closed-record retention before registering or issuing equipment.",
	);
	cleanup();

	render(
		<EquipmentSettings
			initialData={{
				...empty,
				policy: { retentionMonths: 24, revision: 1 },
			}}
		/>,
	);
	expect(screen.queryByText("Retention is not configured yet")).toBeNull();
	expect(screen.getByRole("button", { name: "Edit retention" })).toBeTruthy();
	expect(screen.getByRole("button", { name: "Register item" })).toHaveProperty(
		"disabled",
		true,
	);
	expect(
		screen.getByText(
			"Add an active individually tracked type to register an item. Quantity types do not need item identities.",
		),
	).toBeTruthy();
});

it("validates retention accessibly in its action panel and closes it after saving", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: "org", revision: 1 },
	});
	api.read.mockResolvedValue({
		success: true,
		data: { ...empty, policy: { retentionMonths: 24, revision: 1 } },
	});
	render(<EquipmentSettings initialData={empty} />);
	await user.click(screen.getByRole("button", { name: "Configure retention" }));
	const panel = await screen.findByRole("dialog", {
		name: "Configure record retention",
	});
	await user.click(
		within(panel).getByRole("button", { name: "Save retention policy" }),
	);
	expect(await within(panel).findByRole("alert")).toHaveProperty(
		"textContent",
		"Enter a positive whole number of months.",
	);
	expect(document.activeElement).toBe(
		within(panel).getByLabelText("Closed-record retention (months)"),
	);
	expect(api.change).not.toHaveBeenCalled();
	await user.type(
		within(panel).getByLabelText("Closed-record retention (months)"),
		"24",
	);
	await user.click(
		within(panel).getByRole("button", { name: "Save retention policy" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "configure_policy",
			requestId: expect.any(String),
			retentionMonths: 24,
			expectedRevision: 0,
		}),
	);
	expect(api.toastSuccess).toHaveBeenCalledWith("Retention policy saved.");
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(screen.getByRole("button", { name: "Edit retention" })).toBeTruthy();
});

it("reports a saved change whose refresh failed and keeps the panel open for the same retry", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: "org", revision: 2 },
	});
	api.read.mockResolvedValue({ success: false, error: "offline" });
	render(<EquipmentSettings initialData={configured} />);
	await user.click(screen.getByRole("button", { name: "Edit retention" }));
	const panel = await screen.findByRole("dialog", {
		name: "Edit record retention",
	});
	const months = within(panel).getByLabelText(
		"Closed-record retention (months)",
	);
	expect(months).toHaveProperty("value", "24");
	await user.clear(months);
	await user.type(months, "36");
	await user.click(
		within(panel).getByRole("button", { name: "Save retention policy" }),
	);
	await waitFor(() =>
		expect(api.toastError).toHaveBeenCalledWith(
			"The result could not be loaded. Retry the same submission or reload the setup.",
		),
	);
	expect(api.change).toHaveBeenCalledWith(
		expect.objectContaining({ retentionMonths: 36, expectedRevision: 1 }),
	);
	expect(
		screen.getByRole("dialog", { name: "Edit record retention" }),
	).toBeTruthy();
});

it("creates a quantity type through the public action with its return default", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: "type", revision: 1 },
	});
	api.read.mockResolvedValue({ success: true, data: empty });
	render(<EquipmentSettings initialData={empty} />);
	await user.click(screen.getByRole("button", { name: "Add type" }));
	const panel = await screen.findByRole("dialog", {
		name: "New equipment type",
	});
	await user.type(within(panel).getByLabelText("Type name"), "Shirts");
	await user.click(
		within(panel).getByRole("combobox", { name: "Tracking mode" }),
	);
	await user.click(await screen.findByRole("option", { name: "Quantity" }));
	await user.click(
		within(panel).getByRole("switch", { name: "Return required by default" }),
	);
	await user.click(within(panel).getByRole("button", { name: "Save type" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith({
			kind: "create_type",
			requestId: expect.any(String),
			name: "Shirts",
			trackingMode: "quantity",
			defaultReturnRequired: false,
		}),
	);
});

it("cancels the type panel without a command and starts the next one empty", async () => {
	const user = userEvent.setup();
	render(<EquipmentSettings initialData={empty} />);
	await user.click(screen.getByRole("button", { name: "Add type" }));
	const panel = await screen.findByRole("dialog", {
		name: "New equipment type",
	});
	await user.type(within(panel).getByLabelText("Type name"), "Keys");
	await user.click(within(panel).getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(api.change).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Add type" }));
	const reopened = await screen.findByRole("dialog", {
		name: "New equipment type",
	});
	expect(within(reopened).getByLabelText("Type name")).toHaveProperty(
		"value",
		"",
	);
});
