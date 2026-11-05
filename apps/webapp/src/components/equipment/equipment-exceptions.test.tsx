// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type {
	EquipmentAssignmentView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import {
	EmployeeEquipment,
	EquipmentOverview,
	PersonalEquipment,
} from "./equipment-workspace";

const api = vi.hoisted(() => ({
	change: vi.fn(),
	refresh: vi.fn(),
	replace: vi.fn(),
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipment: api.change,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh, replace: api.replace }),
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});
const view: EquipmentView = {
	canAdminister: true,
	registrationTypes: [],
	readinessItems: [],
	canManage: true,
	policyConfigured: true,
	timezone: "Europe/Berlin",
	today: "2026-11-05",
	employees: [
		{
			id: "15370000-0000-4000-8000-000000000001",
			name: "Alex Current",
			former: false,
		},
		{
			id: "15370000-0000-4000-8000-000000000002",
			name: "Robin Former",
			former: true,
		},
	],
	types: [{ id: "15370000-0000-4000-8000-000000000010", name: "Laptop" }],
	availableQuantityTypes: [],
	availableItems: [
		{
			id: "15370000-0000-4000-8000-000000000020",
			typeId: "15370000-0000-4000-8000-000000000010",
			typeName: "Laptop",
			identifier: "L-01",
			defaultReturnRequired: false,
			revision: 3,
		},
	],
	assignments: [],
};
const heldAssignment: EquipmentAssignmentView = {
	lostQuantity: 0,
	waivedQuantity: 0,
	recoveredQuantity: 0,
	exceptions: [],
	canCloseException: true,
	trackingMode: "individual",
	quantity: 1,
	physicallyReceivedQuantity: 0,
	outstandingQuantity: 1,
	receipts: [],
	id: "15370000-0000-4000-8000-000000000030",
	itemId: view.availableItems[0].id,
	typeId: view.types[0].id,
	typeName: "Laptop",
	identifier: "L-02",
	employeeId: view.employees[0].id,
	holderName: "Alex Current",
	former: false,
	returnRequired: true,
	explicitDeadline: "2026-11-04",
	outstanding: true,
	overdue: true,
	held: true,
	revision: 7,
	canReceive: true,
	issue: {
		id: "issue",
		exceptionId: null,
		quantity: 1,
		actualDate: "2026-11-01",
		condition: "good",
		notes: "Initial handover",
		actorId: "owner",
		actorName: "Pat Owner",
		recordedAt: "2026-11-02T12:00:00Z",
	},
	receipt: null,
};

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
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Close return" }));
	await user.click(screen.getByRole("button", { name: "Record closure" }));
	expect(
		await screen.findByText("Enter a reason for closing this return."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.selectOptions(screen.getByLabelText(/^Outcome/), "waived");
	await user.type(screen.getByLabelText(/^Reason/), "Uniform allowance");
	const quantity = screen.getByLabelText(/^Quantity/);
	await user.clear(quantity);
	await user.type(quantity, "4");
	await user.click(screen.getByRole("button", { name: "Record closure" }));
	expect(
		await screen.findByText(
			"Quantity exceeds the remaining balance for this action.",
		),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(quantity);
	await user.type(quantity, "2");
	await user.click(screen.getByRole("button", { name: "Record closure" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Record closure" }));
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
	await user.type(screen.getByLabelText(/^Reason/), " amended");
	await user.click(screen.getByRole("button", { name: "Record closure" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(3));
	expect(api.change.mock.calls[2][0].requestId).not.toBe(
		api.change.mock.calls[0][0].requestId,
	);
});
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
it("records a bounded recovery linked to its loss with actual date and condition", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: heldAssignment.id, revision: 8 },
	});
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
						outstandingQuantity: 1,
						lostQuantity: 2,
						exceptions: [loss],
					},
				],
			}}
			filters={{}}
		/>,
	);
	await user.click(screen.getByText("Handover history"));
	await user.click(screen.getByRole("button", { name: "Record recovery" }));
	await user.click(screen.getByRole("button", { name: "Confirm recovery" }));
	expect(
		await screen.findByText("Enter the actual handover date."),
	).toBeTruthy();
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-05");
	await user.selectOptions(screen.getByLabelText("Condition"), "damaged");
	await user.type(screen.getByLabelText("Notes (optional)"), "Found at site");
	const quantity = screen.getByLabelText(/^Quantity/);
	await user.clear(quantity);
	await user.type(quantity, "3");
	await user.click(screen.getByRole("button", { name: "Confirm recovery" }));
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(quantity);
	await user.type(quantity, "1");
	await user.click(screen.getByRole("button", { name: "Confirm recovery" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "receive_exception",
		assignmentId: heldAssignment.id,
		exceptionId: loss.id,
		expectedRevision: 7,
		quantity: 1,
		actualDate: "2026-11-05",
		condition: "damaged",
		notes: "Found at site",
	});
	expect(api.refresh).toHaveBeenCalled();
});
it("shows received, lost, waived and recovered quantities without calling a closed obligation a receipt or issued-to-keep", () => {
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
	for (const label of [
		"Lost quantity",
		"Return-waived quantity",
		"Recovered quantity",
		"Physically received quantity",
		"Outstanding quantity",
	])
		expect(screen.getByText(label)).toBeTruthy();
	expect(screen.queryByText("Issued to keep")).toBeNull();
	expect(screen.queryByRole("button", { name: "Close return" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Record recovery" })).toBeNull();
});

it("offers closure on the employee profile and leaves stale feedback with a reload path", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const user = userEvent.setup();
	render(
		<EmployeeEquipment
			employeeId={heldAssignment.employeeId}
			data={{ ...view, assignments: [heldAssignment] }}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Close return" }));
	await user.type(screen.getByLabelText(/^Reason/), "Missing laptop");
	await user.click(screen.getByRole("button", { name: "Record closure" }));
	expect(await screen.findByRole("alert")).toHaveProperty(
		"textContent",
		"This record changed. Reload equipment and review it before submitting again.",
	);
	expect(screen.getByLabelText(/^Reason/)).toHaveProperty(
		"value",
		"Missing laptop",
	);
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(screen.queryByLabelText(/^Reason/)).toBeNull();
	await user.click(screen.getByRole("button", { name: "Reload equipment" }));
	expect(api.refresh).toHaveBeenCalled();
});
it("receives waived equipment through its linked decision without relabeling it as a loss recovery", async () => {
	api.change.mockResolvedValue({ success: false });
	const user = userEvent.setup();
	const waiver = {
		...loss,
		kind: "waived" as const,
		quantity: 1,
		reason: "Permission to keep",
	};
	render(
		<EquipmentOverview
			data={{
				...view,
				assignments: [
					{
						...heldAssignment,
						canCloseException: false,
						canReceive: false,
						outstanding: false,
						outstandingQuantity: 0,
						lostQuantity: 0,
						waivedQuantity: 1,
						exceptions: [waiver],
					},
				],
			}}
			filters={{}}
		/>,
	);
	await user.click(screen.getByText("Handover history"));
	expect(screen.queryByRole("button", { name: "Record recovery" })).toBeNull();
	await user.click(
		screen.getByRole("button", { name: "Record waived receipt" }),
	);
	expect(screen.getByText(/Receive waived equipment/)).toBeTruthy();
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-05");
	await user.click(
		screen.getByRole("button", { name: "Confirm waived receipt" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "receive_exception",
		assignmentId: heldAssignment.id,
		exceptionId: waiver.id,
		quantity: 1,
	});
});
