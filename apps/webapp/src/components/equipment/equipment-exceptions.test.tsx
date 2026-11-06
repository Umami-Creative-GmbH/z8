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
import type { EquipmentAssignmentView } from "@/lib/organization/equipment/contracts";
import { DEFAULT_EQUIPMENT_LIST_QUERY } from "./equipment-list-state";
import {
	EmployeeEquipment,
	EquipmentAssignmentDetail,
	EquipmentOverview,
	PersonalEquipment,
} from "./equipment-workspace";
import {
	heldAssignment as held,
	stubLayoutApis,
	view,
} from "./testing/equipment-view.test-fixture";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
	push: vi.fn(),
	toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipment: api.change,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({
		refresh: api.refresh,
		replace: api.replace,
		push: api.push,
	}),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@tolgee/react", async () => {
	const { translate } = await import("./testing/equipment-view.test-fixture");
	return {
		useTranslate: () => ({ t: translate }),
		useTolgee: () => ({ getLanguage: () => "en" }),
	};
});
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("sonner", () => ({ toast: api.toast }));
vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span aria-hidden="true" />,
}));
beforeAll(stubLayoutApis);
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const heldAssignment: EquipmentAssignmentView = {
	...held,
	canCloseException: true,
};
const loss = {
	id: "15400000-0000-4000-8000-000000000099",
	kind: "lost" as const,
	quantity: 2,
	receivedQuantity: 0,
	reason: "Missing after move",
	actorId: "owner",
	actorName: "Pat Owner",
	recordedAt: "2026-11-04T23:30:00Z",
	canReceive: true,
};
async function closeFromRow(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "Actions for L-02" }));
	await user.click(
		await screen.findByRole("menuitem", { name: "Close return" }),
	);
	return within(await screen.findByRole("dialog"));
}

it("requires a reason for partial loss/waiver and preserves command identity on uncertain retry", async () => {
	api.change.mockResolvedValue({ success: false });
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{
				...view,
				assignments: [
					{
						...heldAssignment,
						trackingMode: "quantity",
						quantity: 3,
						outstandingQuantity: 3,
					},
				],
			}}
			query={DEFAULT_EQUIPMENT_LIST_QUERY}
		/>,
	);
	const panel = await closeFromRow(user);
	expect(
		panel.getByRole("heading", { name: "Close required return" }),
	).toBeTruthy();
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	expect(
		await panel.findByText("Enter a reason for closing this return."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.selectOptions(panel.getByLabelText(/^Outcome/), "waived");
	await user.type(panel.getByLabelText(/^Reason/), "Uniform allowance");
	const quantity = panel.getByLabelText(/^Quantity/);
	await user.clear(quantity);
	await user.type(quantity, "4");
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	expect(
		await panel.findByText(
			"Quantity exceeds the remaining balance for this action.",
		),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(quantity);
	await user.type(quantity, "2");
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	await waitFor(() => expect(api.toast.error).toHaveBeenCalled());
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "close_return",
		assignmentId: heldAssignment.id,
		expectedRevision: 7,
		outcome: "waived",
		quantity: 2,
		reason: "Uniform allowance",
	});
	await user.type(panel.getByLabelText(/^Reason/), " amended");
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(3));
	expect(api.change.mock.calls[2][0].requestId).not.toBe(
		api.change.mock.calls[0][0].requestId,
	);
});

it("closes a return from the assignment page and closes the panel once recorded", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: heldAssignment.id, revision: 8 },
	});
	const user = userEvent.setup();
	render(
		<EquipmentAssignmentDetail
			data={{ ...view, assignments: [heldAssignment] }}
			back="/equipment"
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Close return" }));
	const panel = within(await screen.findByRole("dialog"));
	await user.type(panel.getByLabelText(/^Reason/), "Lost on site");
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	await waitFor(() =>
		expect(api.toast.success).toHaveBeenCalledWith(
			"Equipment action recorded.",
		),
	);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "close_return",
		outcome: "lost",
		quantity: 1,
		reason: "Lost on site",
	});
	expect(api.refresh).toHaveBeenCalled();
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("shows received, lost, waived and recovered quantities without calling a closed obligation a receipt or issued-to-keep", async () => {
	const user = userEvent.setup();
	render(
		<PersonalEquipment
			data={{
				...view,
				canManage: false,
				assignments: [
					{
						...heldAssignment,
						trackingMode: "quantity",
						quantity: 4,
						physicallyReceivedQuantity: 2,
						lostQuantity: 2,
						waivedQuantity: 1,
						recoveredQuantity: 1,
						outstandingQuantity: 0,
						outstanding: false,
						overdue: false,
						canReceive: false,
						canCloseException: false,
						exceptions: [{ ...loss, receivedQuantity: 1, canReceive: false }],
					},
				],
			}}
		/>,
	);
	expect(screen.getByText("Return obligation closed")).toBeTruthy();
	expect(
		screen.getByRole("heading", { name: "Returned & closed" }),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: /L-02/ }));
	for (const label of [
		"Lost quantity",
		"Return-waived quantity",
		"Recovered quantity",
		"Physically received quantity",
		"Outstanding quantity",
	])
		expect(await screen.findByText(label)).toBeTruthy();
	expect(screen.queryByText("Issued to keep")).toBeNull();
	expect(screen.queryByRole("button", { name: "Close return" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Record recovery" })).toBeNull();
});

it("offers closure on the employee page and keeps a stale refusal reviewable", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const user = userEvent.setup();
	render(
		<EmployeeEquipment
			employeeId={heldAssignment.employeeId}
			data={{ ...view, assignments: [heldAssignment] }}
			variant="page"
		/>,
	);
	const panel = await closeFromRow(user);
	await user.type(panel.getByLabelText(/^Reason/), "Missing laptop");
	await user.click(panel.getByRole("button", { name: "Record closure" }));
	await waitFor(() =>
		expect(api.toast.error).toHaveBeenCalledWith(
			"This record changed. Reload equipment and review it before submitting again.",
		),
	);
	expect(panel.getByLabelText(/^Reason/)).toHaveProperty(
		"value",
		"Missing laptop",
	);
	await user.click(panel.getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await user.click(screen.getByRole("button", { name: "Reload equipment" }));
	expect(api.refresh).toHaveBeenCalled();
});

it("does not offer closure to officers without owner or admin authority", async () => {
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{ ...view, canAdminister: false, assignments: [held] }}
			query={DEFAULT_EQUIPMENT_LIST_QUERY}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Actions for L-02" }));
	const menu = within(await screen.findByRole("menu"));
	expect(menu.queryByRole("menuitem", { name: "Close return" })).toBeNull();
});
