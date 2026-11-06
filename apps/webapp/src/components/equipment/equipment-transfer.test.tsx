// @vitest-environment jsdom
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
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
	success: vi.fn(),
	error: vi.fn(),
}));
vi.mock("sonner", () => ({
	toast: { success: api.success, error: api.error },
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
	readinessItems: [],
	canManage: true,
	canAdminister: true,
	registrationTypes: [],
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

const transferView: EquipmentView = {
	...view,
	employees: [
		...view.employees,
		{
			id: "15370000-0000-4000-8000-000000000003",
			name: "Jamie New",
			former: false,
		},
	],
	assignments: [
		{
			...heldAssignment,
			transfer: { expectedIssuanceRevision: 4, defaultReturnRequired: false },
		},
	],
};
it("records separate receipt and issuance evidence, new terms, and a stable request on uncertain retries", async () => {
	api.change.mockResolvedValue({ success: false, code: "DatabaseError" });
	const user = userEvent.setup();
	render(<EquipmentOverview data={transferView} filters={{}} />);
	await user.click(screen.getByRole("button", { name: "Transfer equipment" }));
	expect(
		screen.getByText(
			(_text, element) =>
				element?.tagName === "P" &&
				element.textContent === "L-02 · Alex Current",
		),
	).toBeTruthy();
	const receipt = within(
		screen.getByRole("group", { name: "Receipt from current holder" }),
	);
	const issue = within(screen.getByRole("group", { name: "New issuance" }));
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
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
	const target = issue.getByLabelText(/^Current employee/);
	expect(
		within(target).queryByRole("option", { name: "Alex Current" }),
	).toBeNull();
	expect(
		within(target).queryByRole("option", { name: "Robin Former" }),
	).toBeNull();
	await user.selectOptions(target, transferView.employees[2].id);
	await user.type(issue.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.selectOptions(issue.getByLabelText("Condition"), "good");
	await user.type(
		issue.getByLabelText("Notes (optional)"),
		"Checked and issued",
	);
	expect(
		(issue.getByLabelText("Return required") as HTMLInputElement).checked,
	).toBe(false);
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.error).toHaveBeenCalledOnce());
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "transfer_equipment",
		assignmentId: heldAssignment.id,
		expectedRevision: 7,
		expectedIssuanceRevision: 4,
		quantity: 1,
		employeeId: transferView.employees[2].id,
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
		trackingMode: "quantity" as const,
		quantity: 3,
		physicallyReceivedQuantity: 1,
		outstandingQuantity: 2,
	};
	render(
		<EmployeeEquipment
			data={{ ...transferView, assignments: [source] }}
			employeeId={source.employeeId}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Transfer equipment" }));
	const receipt = within(
		screen.getByRole("group", { name: "Receipt from current holder" }),
	);
	const issue = within(screen.getByRole("group", { name: "New issuance" }));
	await user.selectOptions(
		issue.getByLabelText(/^Current employee/),
		transferView.employees[2].id,
	);
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-04",
	);
	await user.type(issue.getByLabelText(/^Actual handover date/), "2026-11-03");
	await user.clear(receipt.getByLabelText(/^Quantity/));
	await user.type(receipt.getByLabelText(/^Quantity/), "3");
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	expect(
		await screen.findByText("Quantity exceeds the remaining physical balance."),
	).toBeTruthy();
	expect(
		screen.getByText("New issuance cannot precede physical receipt."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(receipt.getByLabelText(/^Quantity/));
	await user.type(receipt.getByLabelText(/^Quantity/), "2");
	await user.clear(issue.getByLabelText(/^Actual handover date/));
	await user.type(issue.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.click(issue.getByLabelText("Return required"));
	await user.type(
		issue.getByLabelText("Explicit return deadline (optional)"),
		"2026-11-05",
	);
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
	expect(api.change.mock.calls[0][0]).toMatchObject({
		quantity: 2,
		issue: { returnRequired: true, explicitDeadline: "2026-11-05" },
	});
	expect(screen.queryByRole("group", { name: "New issuance" })).toBeNull();
});

it("keeps a stale transfer reviewable and uses a new identity after editing the refused payload", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const user = userEvent.setup();
	render(<EquipmentOverview data={transferView} filters={{}} />);
	await user.click(screen.getByRole("button", { name: "Transfer equipment" }));
	const receipt = within(
		screen.getByRole("group", { name: "Receipt from current holder" }),
	);
	const issue = within(screen.getByRole("group", { name: "New issuance" }));
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-03",
	);
	await user.type(issue.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.selectOptions(
		issue.getByLabelText(/^Current employee/),
		transferView.employees[2].id,
	);
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() =>
		expect(api.error).toHaveBeenCalledWith(
			expect.stringContaining("This record changed."),
		),
	);
	await user.type(
		receipt.getByLabelText("Notes (optional)"),
		"Clarified receipt",
	);
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0].requestId).not.toBe(
		api.change.mock.calls[0][0].requestId,
	);
	expect(api.refresh).not.toHaveBeenCalled();
});

it("hides transfer when receipt authority or an authorized current target is absent and keeps personal history read only", () => {
	const { rerender } = render(
		<EquipmentOverview
			data={{
				...transferView,
				assignments: [{ ...heldAssignment, canReceive: false }],
			}}
			filters={{}}
		/>,
	);
	expect(
		screen.queryByRole("button", { name: "Transfer equipment" }),
	).toBeNull();
	rerender(
		<EquipmentOverview
			data={{ ...transferView, employees: view.employees }}
			filters={{}}
		/>,
	);
	expect(
		screen.queryByRole("button", { name: "Transfer equipment" }),
	).toBeNull();
	rerender(<PersonalEquipment data={{ ...transferView, canManage: false }} />);
	expect(
		screen.queryByRole("button", { name: "Transfer equipment" }),
	).toBeNull();
});

it("records a dated transfer from an unknown-date historical holding without inventing its earlier issuance", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	const source = transferView.assignments[0];
	render(
		<EquipmentOverview
			data={{
				...transferView,
				assignments: [
					{
						...source,
						issue: { ...source.issue, actualDate: null, historical: true },
					},
				],
			}}
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Transfer equipment" }));
	const receipt = within(
		screen.getByRole("group", { name: "Receipt from current holder" }),
	);
	const issue = within(screen.getByRole("group", { name: "New issuance" }));
	await user.type(
		receipt.getByLabelText(/^Actual handover date/),
		"2026-11-03",
	);
	await user.selectOptions(
		issue.getByLabelText(/^Current employee/),
		transferView.employees[2].id,
	);
	await user.type(issue.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.click(
		screen.getByRole("button", { name: "Confirm receipt and issuance" }),
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
