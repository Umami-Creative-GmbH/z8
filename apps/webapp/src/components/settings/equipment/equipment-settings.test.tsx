// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { EquipmentSetupView } from "@/lib/organization/equipment/contracts";
import { EquipmentSettings } from "./equipment-settings";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	read: vi.fn(),
	detail: vi.fn(),
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipmentSetup: api.change,
	getEquipmentSetup: api.read,
	getEquipmentSetupDetail: api.detail,
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

it("submits item identities, displays server validation, and preserves request identity for retry", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "identifier_taken" },
	});
	render(<EquipmentSettings initialData={configured} />);
	await user.selectOptions(
		screen.getByLabelText("Equipment type"),
		laptopType.id,
	);
	await user.type(screen.getByLabelText("Equipment identifier"), "L-01");
	await user.type(
		screen.getByLabelText("Manufacturer serial number (optional)"),
		"SN-42",
	);
	await user.click(screen.getByRole("button", { name: "Register item" }));
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"This equipment identifier is already reserved, including archived and retired items.",
	);
	await user.click(screen.getByRole("button", { name: "Register item" }));
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "register_item",
		typeId: laptopType.id,
		identifier: "L-01",
		serialNumber: "SN-42",
	});
});

it("requires confirmation before archiving a type", async () => {
	const user = userEvent.setup();
	render(<EquipmentSettings initialData={configured} />);
	await user.click(screen.getByRole("button", { name: "Archive type Laptop" }));
	expect(await screen.findByRole("alertdialog")).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(api.change).not.toHaveBeenCalled();
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
	await user.click(screen.getByRole("button", { name: "Archive type Laptop" }));
	await user.click(screen.getByRole("button", { name: "Confirm archive" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "archive_type",
				id: laptopType.id,
				expectedRevision: 2,
			}),
		),
	);
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
	await user.click(screen.getByRole("button", { name: "Edit type Laptop" }));
	expect(await screen.findByLabelText("Tracking mode")).toHaveProperty(
		"disabled",
		true,
	);
	await user.click(screen.getByLabelText("Return required by default"));
	await user.click(screen.getByRole("button", { name: "Save type" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "update_type",
				id: laptopType.id,
				expectedRevision: 7,
				trackingMode: "individual",
				defaultReturnRequired: false,
			}),
		),
	);
});
const empty: EquipmentSetupView = {
	policy: null,
	types: [],
	selectableTypes: [],
	items: [],
};

it("validates retention accessibly and enables registration after saving policy", async () => {
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
	expect(
		(screen.getByRole("button", { name: "Register item" }) as HTMLButtonElement)
			.disabled,
	).toBe(true);
	await user.click(
		screen.getByRole("button", { name: "Save retention policy" }),
	);
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"Enter a positive whole number of months.",
	);
	expect(document.activeElement).toBe(
		screen.getByLabelText("Closed-record retention (months)"),
	);
	expect(api.change).not.toHaveBeenCalled();
	await user.type(
		screen.getByLabelText("Closed-record retention (months)"),
		"24",
	);
	await user.click(
		screen.getByRole("button", { name: "Save retention policy" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "configure_policy",
				retentionMonths: 24,
				expectedRevision: 0,
			}),
		),
	);
	expect(await screen.findByText("Retention policy saved.")).toBeTruthy();
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
	await user.type(screen.getByLabelText("Type name"), "Shirts");
	await user.selectOptions(screen.getByLabelText("Tracking mode"), "quantity");
	await user.click(screen.getByLabelText("Return required by default"));
	await user.click(screen.getByRole("button", { name: "Save type" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "create_type",
				name: "Shirts",
				trackingMode: "quantity",
				defaultReturnRequired: false,
			}),
		),
	);
});
