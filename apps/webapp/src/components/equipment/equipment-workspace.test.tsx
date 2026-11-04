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
		actualDate: "2026-11-01",
		condition: "good",
		notes: "Initial handover",
		actorId: "owner",
		actorName: "Pat Owner",
		recordedAt: "2026-11-02T12:00:00Z",
	},
	receipt: null,
};
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
					actualDate: "2026-11-01",
					condition: "good",
					notes: "Initial handover",
					actorId: "owner",
					actorName: "Pat Owner",
					recordedAt: "2026-11-02T12:00:00Z",
				},
				receipt: {
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
