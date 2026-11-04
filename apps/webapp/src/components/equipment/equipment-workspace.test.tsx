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
it("lets scoped officers register while issuing without offering unrestricted setup", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	render(
		<EquipmentOverview
			data={{
				...view,
				canAdminister: false,
				availableItems: [],
				registrationTypes: [
					{ id: view.types[0].id, name: "Laptop", defaultReturnRequired: true },
				],
			}}
			filters={{}}
		/>,
	);
	expect(
		screen.queryByRole("link", {
			name: "Manage types, item identities and retention",
		}),
	).toBeNull();
	await user.click(screen.getByRole("button", { name: "Issue equipment" }));
	await user.selectOptions(screen.getByLabelText(/Equipment item/), "new");
	await user.selectOptions(
		screen.getByLabelText(/Equipment type/),
		view.types[0].id,
	);
	await user.type(screen.getByLabelText(/Equipment identifier/), "L-NEW");
	await user.selectOptions(
		screen.getByLabelText("Current employee"),
		view.employees[0].id,
	);
	await user.type(screen.getByLabelText(/Actual handover date/), "2026-11-04");
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	await waitFor(() =>
		expect(api.change).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "register_and_issue_individual",
				typeId: view.types[0].id,
				identifier: "L-NEW",
				employeeId: view.employees[0].id,
				expectedRevision: 0,
			}),
		),
	);
});
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
	departureDeadline: null,
	effectiveDeadline: "2026-11-04",
	employmentPeriodId: null,
	departureId: null,
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
it("shows the effective and independent explicit/departure dates on former-employee follow-up", () => {
	render(
		<EquipmentOverview
			data={{
				...view,
				assignments: [
					{
						...heldAssignment,
						former: true,
						effectiveDeadline: "2026-11-03",
						departureDeadline: "2026-11-03",
					},
				],
			}}
			filters={{ former: true, outstanding: true }}
		/>,
	);
	const card = screen.getByRole("article");
	expect(within(card).getByText("Effective return deadline")).toBeTruthy();
	expect(within(card).getByText("Departure return deadline")).toBeTruthy();
	expect(within(card).getByText("Explicit return deadline")).toBeTruthy();
	expect(within(card).getAllByText("Nov 3, 2026")).toHaveLength(2);
	expect(within(card).getByText("Nov 4, 2026")).toBeTruthy();
	expect(
		within(card).getByRole("button", { name: "Record receipt" }),
	).toBeTruthy();
});
it("requires an actual handover date, snapshots the selected type default, and retries the same handover identity", async () => {
	api.change.mockResolvedValue({ success: false, code: "DatabaseError" });
	const user = userEvent.setup();
	render(<EquipmentOverview data={view} filters={{}} />);
	await user.click(screen.getByRole("button", { name: "Issue equipment" }));
	await user.selectOptions(
		screen.getByLabelText(/^Equipment item/),
		view.availableItems[0].id,
	);
	const employeeSelect = screen.getByLabelText(/^Current employee/);
	await user.selectOptions(employeeSelect, view.employees[0].id);
	expect(
		within(employeeSelect).queryByRole("option", { name: "Robin Former" }),
	).toBeNull();
	expect(
		(screen.getByLabelText("Return required") as HTMLInputElement).checked,
	).toBe(false);
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	expect(
		await screen.findByText("Enter the actual handover date."),
	).toBeTruthy();
	expect(document.activeElement).toBe(
		screen.getByLabelText(/^Actual handover date/),
	);
	expect(api.change).not.toHaveBeenCalled();
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.selectOptions(screen.getByLabelText("Condition"), "worn");
	await user.type(screen.getByLabelText("Notes (optional)"), "With charger");
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "issue_individual",
		expectedRevision: 3,
		actualDate: "2026-11-04",
		condition: "worn",
		notes: "With charger",
		returnRequired: false,
		explicitDeadline: null,
	});
});

it("keeps personal history read-only and shows returned condition separately from issuance evidence", () => {
	const data: EquipmentView = {
		...view,
		canManage: false,
		availableItems: [],
		employees: [],
		types: [],
		assignments: [
			{
				id: "assignment",
				trackingMode: "individual",
				quantity: 1,
				physicallyReceivedQuantity: 1,
				outstandingQuantity: 0,
				receipts: [
					{
						id: "receipt",
						quantity: 1,
						actualDate: "2026-11-04",
						condition: "damaged",
						notes: "Cracked screen",
						actorId: "admin",
						actorName: "Sam Admin",
						recordedAt: "2026-11-05T10:00:00Z",
					},
				],
				itemId: "item",
				typeId: "type",
				typeName: "Laptop",
				identifier: "L-02",
				employeeId: "employee",
				holderName: "Alex Current",
				former: false,
				returnRequired: true,
				explicitDeadline: "2026-11-04",
				outstanding: false,
				overdue: false,
				held: false,
				revision: 2,
				canReceive: false,
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
				receipt: {
					id: "receipt",
					quantity: 1,
					actualDate: "2026-11-04",
					condition: "damaged",
					notes: "Cracked screen",
					actorId: "admin",
					actorName: "Sam Admin",
					recordedAt: "2026-11-05T10:00:00Z",
				},
			},
		],
	};
	render(<PersonalEquipment data={data} />);
	expect(screen.getByText("Cracked screen")).toBeTruthy();
	expect(screen.getByText("Sam Admin")).toBeTruthy();
	expect(screen.getByText("Pat Owner")).toBeTruthy();
	expect(screen.getAllByText("Physically received")).toHaveLength(2);
	expect(screen.queryByRole("button", { name: "Issue equipment" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Record receipt" })).toBeNull();
});

it("records a dated receipt with its own condition and notes from the overview", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: heldAssignment.id, revision: 8 },
	});
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{ ...view, assignments: [heldAssignment] }}
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Record receipt" }));
	const form = screen
		.getByRole("heading", { name: /Confirm physical receipt/ })
		.closest("form");
	if (!form) throw new Error("Expected receipt form");
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-10-31");
	await user.click(
		within(form).getByRole("button", { name: "Record receipt" }),
	);
	expect(
		await screen.findByText("Receipt cannot precede the recorded issuance."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(screen.getByLabelText(/^Actual handover date/));
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.selectOptions(screen.getByLabelText("Condition"), "damaged");
	await user.type(screen.getByLabelText("Notes (optional)"), "Cracked screen");
	await user.click(
		within(form).getByRole("button", { name: "Record receipt" }),
	);
	await waitFor(() => expect(api.refresh).toHaveBeenCalled());
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "receive_individual",
		assignmentId: heldAssignment.id,
		expectedRevision: 7,
		actualDate: "2026-11-04",
		condition: "damaged",
		notes: "Cracked screen",
	});
	expect(await screen.findByRole("status")).toHaveProperty(
		"textContent",
		"Handover recorded.",
	);
});

it("keeps former employee profiles usable for receipt and history without offering issuance", async () => {
	const data: EquipmentView = {
		...view,
		assignments: [
			{
				...heldAssignment,
				employeeId: view.employees[1].id,
				holderName: "Robin Former",
				former: true,
			},
		],
	};
	render(<EmployeeEquipment data={data} employeeId={view.employees[1].id} />);
	expect(screen.queryByRole("button", { name: "Issue equipment" })).toBeNull();
	expect(screen.getByRole("button", { name: "Record receipt" })).toBeTruthy();
	expect(
		screen.getByText(
			"Former employees remain available for returns and history. New issuance is unavailable.",
		),
	).toBeTruthy();
});

it("keeps holder, type, outstanding, overdue and former filters in the overview URL", async () => {
	const user = userEvent.setup();
	render(<EquipmentOverview data={view} filters={{}} />);
	await user.selectOptions(
		screen.getByLabelText("Holder"),
		view.employees[1].id,
	);
	await user.selectOptions(screen.getByLabelText("Type"), view.types[0].id);
	for (const label of [
		"Outstanding returns",
		"Overdue returns",
		"Former employees",
	])
		await user.selectOptions(screen.getByLabelText(label), "true");
	await user.click(screen.getByRole("button", { name: "Apply filters" }));
	await waitFor(() => expect(api.replace).toHaveBeenCalled());
	const target = new URL(api.replace.mock.calls[0][0], "https://z8.test");
	expect(target.pathname).toBe("/equipment");
	expect(Object.fromEntries(target.searchParams)).toEqual({
		holderId: view.employees[1].id,
		typeId: view.types[0].id,
		outstanding: "true",
		overdue: "true",
		former: "true",
	});
});

const quantityType = {
	id: "15380000-0000-4000-8000-000000000010",
	name: "Shirt size M",
	defaultReturnRequired: true,
	revision: 2,
};
const partialAssignment: EquipmentAssignmentView = {
	...heldAssignment,
	itemId: null,
	trackingMode: "quantity",
	quantity: 3,
	physicallyReceivedQuantity: 2,
	outstandingQuantity: 1,
	identifier: quantityType.name,
	typeId: quantityType.id,
	typeName: quantityType.name,
	issue: { ...heldAssignment.issue, quantity: 3 },
	receipts: [
		{
			id: "partial",
			quantity: 2,
			actualDate: "2026-11-03",
			condition: "good",
			notes: "Two shirts back",
			actorId: "admin",
			actorName: "Sam Admin",
			recordedAt: "2026-11-04T10:00:00Z",
		},
	],
	receipt: {
		id: "partial",
		quantity: 2,
		actualDate: "2026-11-03",
		condition: "good",
		notes: "Two shirts back",
		actorId: "admin",
		actorName: "Sam Admin",
		recordedAt: "2026-11-04T10:00:00Z",
	},
};
it("issues a positive whole quantity without requiring an artificial individual identity", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: "new", revision: 1 },
	});
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{
				...view,
				availableItems: [],
				availableQuantityTypes: [quantityType],
			}}
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Issue equipment" }));
	await user.selectOptions(
		screen.getByLabelText(/^Equipment item/),
		quantityType.id,
	);
	await user.selectOptions(
		screen.getByLabelText(/^Current employee/),
		view.employees[0].id,
	);
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-04");
	const quantity = screen.getByLabelText(/^Quantity/);
	await user.clear(quantity);
	await user.type(quantity, "1.5");
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	expect(
		await screen.findByText("Enter a positive whole quantity."),
	).toBeTruthy();
	expect(document.activeElement).toBe(quantity);
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(quantity);
	await user.type(quantity, "3");
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	await waitFor(() => expect(api.change).toHaveBeenCalled());
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "issue_quantity",
		typeId: quantityType.id,
		quantity: 3,
		expectedRevision: 2,
		returnRequired: true,
	});
	expect(api.change.mock.calls[0][0]).not.toHaveProperty("itemId");
});
it("shows independent partial receipt totals and caps a subsequent receipt at the physical balance", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: partialAssignment.id, revision: 8 },
	});
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{ ...view, assignments: [partialAssignment] }}
			filters={{}}
		/>,
	);
	const article = screen.getByRole("article");
	expect(
		within(article).getByText("Issued quantity").nextElementSibling
			?.textContent,
	).toBe("3");
	expect(
		within(article).getByText("Physically received quantity").nextElementSibling
			?.textContent,
	).toBe("2");
	expect(
		within(article).getByText("Outstanding quantity").nextElementSibling
			?.textContent,
	).toBe("1");
	expect(within(article).getByText("Overdue")).toBeTruthy();
	expect(within(article).getByText("Two shirts back")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Record receipt" }));
	const form = screen
		.getByRole("heading", { name: /Confirm physical receipt/ })
		.closest("form");
	if (!form) throw new Error("Expected receipt form");
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-04");
	const quantity = screen.getByLabelText(/^Quantity/);
	await user.clear(quantity);
	await user.type(quantity, "2");
	await user.click(
		within(form).getByRole("button", { name: "Record receipt" }),
	);
	expect(
		await screen.findByText("Quantity exceeds the remaining physical balance."),
	).toBeTruthy();
	expect(api.change).not.toHaveBeenCalled();
	await user.clear(quantity);
	await user.type(quantity, "1");
	await user.selectOptions(screen.getByLabelText("Condition"), "damaged");
	await user.type(screen.getByLabelText("Notes (optional)"), "Torn sleeve");
	await user.click(
		within(form).getByRole("button", { name: "Record receipt" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalled());
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "receive_quantity",
		assignmentId: partialAssignment.id,
		quantity: 1,
		expectedRevision: 7,
		condition: "damaged",
		notes: "Torn sleeve",
	});
});

it("keeps individual issuance usable after correcting an invalid quantity by selecting an individual item", async () => {
	api.change.mockResolvedValue({
		success: true,
		data: { ok: true, id: "new", revision: 1 },
	});
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{ ...view, availableQuantityTypes: [quantityType] }}
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Issue equipment" }));
	await user.selectOptions(
		screen.getByLabelText(/^Equipment item/),
		quantityType.id,
	);
	await user.selectOptions(
		screen.getByLabelText(/^Current employee/),
		view.employees[0].id,
	);
	await user.type(screen.getByLabelText(/^Actual handover date/), "2026-11-04");
	await user.clear(screen.getByLabelText(/^Quantity/));
	await user.type(screen.getByLabelText(/^Quantity/), "0");
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	expect(
		await screen.findByText("Enter a positive whole quantity."),
	).toBeTruthy();
	await user.selectOptions(
		screen.getByLabelText(/^Equipment item/),
		view.availableItems[0].id,
	);
	expect(screen.queryByLabelText(/^Quantity/)).toBeNull();
	await user.click(screen.getByRole("button", { name: "Record issuance" }));
	await waitFor(() => expect(api.change).toHaveBeenCalled());
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "issue_individual",
		itemId: view.availableItems[0].id,
		expectedRevision: 3,
	});
	expect(api.change.mock.calls[0][0]).not.toHaveProperty("quantity");
});
it("keeps all partial receipts visible on personal history without offering staff actions", () => {
	render(
		<PersonalEquipment
			data={{
				...view,
				canManage: false,
				availableItems: [],
				availableQuantityTypes: [],
				employees: [],
				types: [],
				assignments: [
					{
						...partialAssignment,
						canReceive: false,
						receipts: [
							...partialAssignment.receipts,
							{
								id: "last",
								quantity: 1,
								condition: "damaged",
								actualDate: "2026-11-04",
								notes: "One torn shirt",
								actorName: "Pat Owner",
								actorId: "owner",
								recordedAt: "2026-11-05T10:00:00Z",
							},
						],
						quantity: 3,
						physicallyReceivedQuantity: 3,
						outstandingQuantity: 0,
						held: false,
						outstanding: false,
						overdue: false,
					},
				],
			}}
		/>,
	);
	expect(screen.getByText("Two shirts back")).toBeTruthy();
	expect(screen.getByText("One torn shirt")).toBeTruthy();
	expect(
		screen.getByText("Outstanding quantity").nextElementSibling?.textContent,
	).toBe("0");
	expect(screen.queryByRole("button", { name: "Record receipt" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Issue equipment" })).toBeNull();
});
