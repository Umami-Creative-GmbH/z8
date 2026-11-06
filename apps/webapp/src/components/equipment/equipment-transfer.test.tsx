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
import type { EquipmentView } from "@/lib/organization/equipment/contracts";
import { DEFAULT_EQUIPMENT_LIST_QUERY } from "./equipment-list-state";
import {
	EmployeeEquipment,
	EquipmentAssignmentDetail,
	EquipmentOverview,
	PersonalEquipment,
} from "./equipment-workspace";
import {
	heldAssignment,
	ids,
	issue,
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

const transferView: EquipmentView = {
	...view,
	employees: [
		...view.employees,
		{ id: ids.jamie, name: "Jamie New", image: null, former: false },
	],
	assignments: [
		{
			...heldAssignment,
			transfer: { expectedIssuanceRevision: 4, defaultReturnRequired: false },
		},
	],
};
const query = DEFAULT_EQUIPMENT_LIST_QUERY;
async function openTransfer(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "Actions for L-02" }));
	await user.click(await screen.findByRole("menuitem", { name: "Transfer" }));
	const panel = within(await screen.findByRole("dialog"));
	return {
		panel,
		receipt: within(
			panel.getByRole("group", { name: "Receipt from current holder" }),
		),
		issuance: within(panel.getByRole("group", { name: "New issuance" })),
	};
}

it("records separate receipt and issuance evidence, new terms, and a stable request on uncertain retries", async () => {
	api.change.mockResolvedValue({ success: false, code: "DatabaseError" });
	const user = userEvent.setup();
	render(<EquipmentOverview data={transferView} query={query} />);
	const { panel, receipt, issuance } = await openTransfer(user);
	expect(
		panel.getByRole("heading", { name: "Transfer equipment" }),
	).toBeTruthy();
	expect(panel.getByText("Alex Current", { exact: false })).toBeTruthy();
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	expect(
		await receipt.findByText("Enter the actual handover date."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-03",
	);
	await user.selectOptions(receipt.getByLabelText("Condition"), "worn");
	await user.type(
		receipt.getByLabelText("Notes (optional)"),
		"Received with charger",
	);
	const target = issuance.getByLabelText(/^Current employee/);
	expect(
		within(target).queryByRole("option", { name: "Alex Current" }),
	).toBeNull();
	expect(
		within(target).queryByRole("option", { name: "Robin Former" }),
	).toBeNull();
	await user.selectOptions(target, ids.jamie);
	await user.type(
		issuance.getByLabelText(/^Actual handover date/),
		"2026-11-04",
	);
	await user.selectOptions(issuance.getByLabelText("Condition"), "good");
	await user.type(
		issuance.getByLabelText("Notes (optional)"),
		"Checked and issued",
	);
	expect(
		(issuance.getByLabelText("Return required") as HTMLInputElement).checked,
	).toBe(false);
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.toast.error).toHaveBeenCalled());
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "transfer_equipment",
		assignmentId: heldAssignment.id,
		expectedRevision: 7,
		expectedIssuanceRevision: 4,
		quantity: 1,
		employeeId: ids.jamie,
		receipt: {
			actualDate: "2026-11-03",
			condition: "worn",
			notes: "Received with charger",
		},
		issue: {
			actualDate: "2026-11-04",
			condition: "good",
			notes: "Checked and issued",
			returnRequired: false,
			explicitDeadline: null,
		},
	});
});

it("validates a partial quantity and date order before submitting the new return agreement", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: "new-assignment", revision: 1 },
	});
	const user = userEvent.setup();
	const source = {
		...transferView.assignments[0],
		itemId: null,
		identifier: "L-02",
		trackingMode: "quantity" as const,
		quantity: 3,
		physicallyReceivedQuantity: 1,
		outstandingQuantity: 2,
	};
	render(
		<EmployeeEquipment
			data={{ ...transferView, assignments: [source] }}
			employeeId={source.employeeId}
			variant="page"
		/>,
	);
	const { panel, receipt, issuance } = await openTransfer(user);
	await user.selectOptions(
		issuance.getByLabelText(/^Current employee/),
		ids.jamie,
	);
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-04",
	);
	await user.type(
		issuance.getByLabelText(/^Actual handover date/),
		"2026-11-03",
	);
	await user.clear(receipt.getByLabelText(/^Quantity/));
	await user.type(receipt.getByLabelText(/^Quantity/), "3");
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	expect(
		await panel.findByText("Quantity exceeds the remaining physical balance."),
	).toBeTruthy();
	expect(
		panel.getByText("New issuance cannot precede physical receipt."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(receipt.getByLabelText(/^Quantity/));
	await user.type(receipt.getByLabelText(/^Quantity/), "2");
	await user.clear(issuance.getByLabelText(/^Actual handover date/));
	await user.type(
		issuance.getByLabelText(/^Actual handover date/),
		"2026-11-04",
	);
	await user.click(issuance.getByLabelText("Return required"));
	await user.type(
		issuance.getByLabelText("Explicit return deadline (optional)"),
		"2026-11-05",
	);
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
	expect(api.change.mock.calls[0][0]).toMatchObject({
		quantity: 2,
		issue: { returnRequired: true, explicitDeadline: "2026-11-05" },
	});
	await waitFor(() =>
		expect(screen.queryByRole("group", { name: "New issuance" })).toBeNull(),
	);
});

it("keeps a stale transfer reviewable and uses a new identity after editing the refused payload", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const user = userEvent.setup();
	render(<EquipmentOverview data={transferView} query={query} />);
	const { panel, receipt, issuance } = await openTransfer(user);
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-03",
	);
	await user.type(
		issuance.getByLabelText(/^Actual handover date/),
		"2026-11-04",
	);
	await user.selectOptions(
		issuance.getByLabelText(/^Current employee/),
		ids.jamie,
	);
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() =>
		expect(api.toast.error).toHaveBeenCalledWith(
			expect.stringContaining("This record changed."),
		),
	);
	await user.type(
		receipt.getByLabelText("Notes (optional)"),
		"Clarified receipt",
	);
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0].requestId).not.toBe(
		api.change.mock.calls[0][0].requestId,
	);
	expect(api.refresh).not.toHaveBeenCalled();
});

it("hides transfer when receipt authority or an authorized current target is absent and keeps personal history read only", async () => {
	const user = userEvent.setup();
	const menuItems = async () => {
		await user.click(screen.getByRole("button", { name: "Actions for L-02" }));
		const items = within(await screen.findByRole("menu"))
			.getAllByRole("menuitem")
			.map((item) => item.textContent);
		await user.keyboard("{Escape}");
		return items;
	};
	const { rerender } = render(
		<EquipmentOverview
			data={{
				...transferView,
				assignments: [{ ...heldAssignment, canReceive: false }],
			}}
			query={query}
		/>,
	);
	expect(await menuItems()).not.toContain("Transfer");
	rerender(
		<EquipmentOverview
			data={{ ...transferView, employees: view.employees }}
			query={query}
		/>,
	);
	expect(await menuItems()).not.toContain("Transfer");
	rerender(<PersonalEquipment data={{ ...transferView, canManage: false }} />);
	expect(screen.queryByRole("button", { name: "Actions for L-02" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Transfer" })).toBeNull();
});

it("records a dated transfer from an unknown-date historical holding on the assignment page without inventing its earlier issuance", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	const source = transferView.assignments[0];
	render(
		<EquipmentAssignmentDetail
			data={{
				...transferView,
				assignments: [
					{
						...source,
						issue: { ...issue, actualDate: null, historical: true },
					},
				],
			}}
			back="/equipment"
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Transfer" }));
	const panel = within(await screen.findByRole("dialog"));
	const receipt = within(
		panel.getByRole("group", { name: "Receipt from current holder" }),
	);
	const issuance = within(panel.getByRole("group", { name: "New issuance" }));
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-03",
	);
	await user.selectOptions(
		issuance.getByLabelText(/^Current employee/),
		ids.jamie,
	);
	await user.type(
		issuance.getByLabelText(/^Actual handover date/),
		"2026-11-04",
	);
	await user.click(
		panel.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "transfer_equipment",
				receipt: expect.objectContaining({ actualDate: "2026-11-03" }),
				issue: expect.objectContaining({ actualDate: "2026-11-04" }),
			}),
		),
	);
});
