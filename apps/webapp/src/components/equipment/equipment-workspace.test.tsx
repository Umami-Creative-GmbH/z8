// @vitest-environment jsdom
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { EquipmentView } from "@/lib/organization/equipment/contracts";
import { DEFAULT_EQUIPMENT_LIST_QUERY } from "./equipment-list-state";
import { EmployeeEquipment, EquipmentOverview } from "./equipment-workspace";
import {
	heldAssignment,
	ids,
	partialAssignment,
	quantityType,
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

const query = DEFAULT_EQUIPMENT_LIST_QUERY;
function overview(data: EquipmentView, listQuery = query) {
	return render(<EquipmentOverview data={data} query={listQuery} />);
}
async function openPanel(
	user: ReturnType<typeof userEvent.setup>,
	name: string,
) {
	// The header button; an empty list repeats "Issue equipment" as its call to action.
	await user.click(screen.getAllByRole("button", { name })[0]);
	return within(await screen.findByRole("dialog"));
}
async function openRowAction(
	user: ReturnType<typeof userEvent.setup>,
	identifier: string,
	action: string,
) {
	await user.click(
		screen.getByRole("button", { name: `Actions for ${identifier}` }),
	);
	await user.click(await screen.findByRole("menuitem", { name: action }));
	return within(await screen.findByRole("dialog"));
}
async function openHistorical(user: ReturnType<typeof userEvent.setup>) {
	await user.click(
		screen.getByRole("button", { name: "More ways to record equipment" }),
	);
	await user.click(
		await screen.findByRole("menuitem", { name: "Record existing holding" }),
	);
	return within(await screen.findByRole("dialog"));
}

describe("Equipment overview", () => {
	it("shows the header, key figures and the outstanding assignments table", () => {
		overview({
			...view,
			assignments: [
				heldAssignment,
				{
					...partialAssignment,
					id: "15380000-0000-4000-8000-000000000031",
					overdue: false,
					effectiveDeadline: "2026-11-12",
					explicitDeadline: "2026-11-12",
				},
				{
					...heldAssignment,
					id: "15380000-0000-4000-8000-000000000032",
					identifier: "L-BACK",
					outstanding: false,
					overdue: false,
					held: false,
					outstandingQuantity: 0,
				},
			],
		});
		expect(
			screen.getByRole("heading", { level: 1, name: "Equipment" }),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Who holds each item, what must come back, and every recorded handover.",
			),
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Equipment settings" })
				.getAttribute("href"),
		).toBe("/settings/equipment");
		expect(
			screen.getByRole("button", { name: "Reload equipment" }),
		).toBeTruthy();
		const outstanding = screen.getByRole("button", {
			name: "Show outstanding returns",
		});
		expect(outstanding.getAttribute("aria-pressed")).toBe("true");
		expect(screen.getByText("Across 1 employee")).toBeTruthy();
		expect(screen.getByText("Oldest: 1 day overdue")).toBeTruthy();
		expect(screen.getByText("Next: Nov 12, 2026")).toBeTruthy();
		expect(screen.getByText("2 of 3 assignments")).toBeTruthy();
		const rows = screen.getAllByRole("row").slice(1);
		expect(rows).toHaveLength(2);
		// Overdue first, then the soonest deadline.
		expect(within(rows[0]).getByText("L-02")).toBeTruthy();
		expect(within(rows[0]).getByText("Overdue")).toBeTruthy();
		expect(within(rows[0]).getByText("1 day overdue")).toBeTruthy();
		expect(within(rows[1]).getByText("Quantity · Shirt size M")).toBeTruthy();
		expect(within(rows[1]).getByText("in 7 days")).toBeTruthy();
		expect(within(rows[1]).getByText("Outstanding return")).toBeTruthy();
		expect(
			within(rows[0])
				.getByRole("link", { name: "Alex Current" })
				.getAttribute("href"),
		).toBe(`/equipment/employees/${ids.alex}`);
		expect(
			screen
				.getByRole("columnheader", { name: /Return deadline/ })
				.getAttribute("aria-sort"),
		).toBe("ascending");
	});

	it("opens an assignment's page from its row and keeps the filtered list to return to", async () => {
		const user = userEvent.setup();
		overview(
			{ ...view, assignments: [heldAssignment] },
			{ ...query, status: "overdue" },
		);
		await user.click(screen.getByText("1 day overdue"));
		const target = new URL(api.push.mock.calls[0][0], "https://z8.test");
		expect(target.pathname).toBe(`/equipment/assignments/${heldAssignment.id}`);
		expect(target.searchParams.get("back")).toBe("/equipment?overdue=true");
		await user.click(screen.getByRole("button", { name: "Actions for L-02" }));
		await user.click(
			await screen.findByRole("menuitem", { name: "View details" }),
		);
		expect(api.push).toHaveBeenCalledTimes(2);
	});

	it("sorts by a column header and flips it on the second click", async () => {
		const user = userEvent.setup();
		overview({
			...view,
			assignments: [
				{ ...heldAssignment, holderName: "Zoe" },
				{
					...heldAssignment,
					id: "15380000-0000-4000-8000-000000000033",
					identifier: "L-03",
					holderName: "Anna",
					overdue: false,
					effectiveDeadline: null,
				},
			],
		});
		const holder = () => screen.getByRole("columnheader", { name: /Holder/ });
		await user.click(within(holder()).getByRole("button"));
		expect(holder().getAttribute("aria-sort")).toBe("ascending");
		expect(
			within(screen.getAllByRole("row")[1]).getByText("Anna"),
		).toBeTruthy();
		await user.click(within(holder()).getByRole("button"));
		expect(holder().getAttribute("aria-sort")).toBe("descending");
		expect(within(screen.getAllByRole("row")[1]).getByText("Zoe")).toBeTruthy();
	});

	it("applies status, KPI and former-employee filters immediately and keeps them in the URL", async () => {
		const user = userEvent.setup();
		overview({ ...view, assignments: [heldAssignment] });
		await user.click(screen.getByRole("radio", { name: /Overdue/ }));
		expect(api.replace).toHaveBeenLastCalledWith("/equipment?overdue=true", {
			scroll: false,
		});
		await user.click(screen.getByRole("radio", { name: "All" }));
		expect(api.replace).toHaveBeenLastCalledWith("/equipment?status=all", {
			scroll: false,
		});
		await user.click(
			screen.getByRole("button", { name: "Show returns due within 14 days" }),
		);
		expect(api.replace).toHaveBeenLastCalledWith("/equipment?status=soon", {
			scroll: false,
		});
		expect(
			screen.getByText("No equipment assignments match this view."),
		).toBeTruthy();
		await user.click(
			screen.getByRole("switch", { name: "Show former employees" }),
		);
		expect(api.replace).toHaveBeenLastCalledWith(
			"/equipment?status=soon&former=false",
			{ scroll: false },
		);
		await user.click(
			screen.getAllByRole("button", { name: "Clear filters" })[0],
		);
		expect(api.replace).toHaveBeenLastCalledWith("/equipment", {
			scroll: false,
		});
		expect(screen.getAllByRole("row")).toHaveLength(2);
	});

	it("opens a reminder link on the holder's outstanding returns and filters by type and search", async () => {
		const user = userEvent.setup();
		const robins = {
			...heldAssignment,
			id: "15380000-0000-4000-8000-000000000034",
			identifier: "L-ROBIN",
			employeeId: ids.robin,
			holderName: "Robin Former",
			former: true,
		};
		const { rerender } = overview(
			{ ...view, assignments: [heldAssignment, robins] },
			{ ...query, holderId: ids.robin },
		);
		expect(screen.getAllByRole("row")).toHaveLength(2);
		expect(screen.getByText("L-ROBIN")).toBeTruthy();
		expect(
			screen.getByRole("combobox", { name: "Holder" }).textContent,
		).toContain("Robin Former");
		rerender(
			<EquipmentOverview
				data={{ ...view, assignments: [heldAssignment, robins] }}
				query={{ ...query, typeId: "15380000-0000-4000-8000-0000000000ff" }}
			/>,
		);
		expect(
			screen.getByText("No equipment assignments match this view."),
		).toBeTruthy();
		rerender(
			<EquipmentOverview
				data={{ ...view, assignments: [heldAssignment, robins] }}
				query={query}
			/>,
		);
		await user.type(
			screen.getByRole("searchbox", { name: "Search assignments" }),
			"robin",
		);
		expect(screen.getAllByRole("row")).toHaveLength(2);
		expect(screen.getByText("L-ROBIN")).toBeTruthy();
		// The search is not part of the URL.
		expect(api.replace).not.toHaveBeenCalled();
	});

	it("selects a holder through the searchable holder filter", async () => {
		const user = userEvent.setup();
		overview({ ...view, assignments: [heldAssignment] });
		await user.click(screen.getByRole("combobox", { name: "Holder" }));
		await user.click(
			await screen.findByRole("option", { name: /Robin Former/ }),
		);
		expect(api.replace).toHaveBeenLastCalledWith(
			`/equipment?holderId=${ids.robin}`,
			{ scroll: false },
		);
	});

	it("shows set-up guidance instead of the list until equipment is set up", () => {
		const { rerender } = overview({
			...view,
			policyConfigured: false,
			types: [],
		});
		expect(screen.getByText("Set up equipment first")).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Set up equipment" })
				.getAttribute("href"),
		).toBe("/settings/equipment");
		expect(screen.queryByRole("table")).toBeNull();
		rerender(
			<EquipmentOverview
				data={{ ...view, canAdminister: false, types: [] }}
				query={query}
			/>,
		);
		expect(
			screen.getByText(/Ask an administrator to set up equipment types/),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Set up equipment" })).toBeNull();
	});

	it("invites the first issuance when nothing has been issued yet", async () => {
		const user = userEvent.setup();
		overview(view);
		expect(screen.getByText("Nothing issued yet")).toBeTruthy();
		const issueButtons = screen.getAllByRole("button", {
			name: "Issue equipment",
		});
		expect(issueButtons).toHaveLength(2);
		await user.click(issueButtons[1]);
		expect(await screen.findByRole("dialog")).toBeTruthy();
	});
});

describe("Issuing equipment", () => {
	it("lets scoped officers register while issuing without offering unrestricted setup", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		overview({
			...view,
			canAdminister: false,
			availableItems: [],
			registrationTypes: [
				{ id: ids.laptopType, name: "Laptop", defaultReturnRequired: true },
			],
		});
		expect(
			screen.queryByRole("link", { name: "Equipment settings" }),
		).toBeNull();
		const panel = await openPanel(user, "Issue equipment");
		await user.selectOptions(panel.getByLabelText(/Equipment item/), "new");
		await user.selectOptions(
			panel.getByLabelText(/Equipment type/),
			ids.laptopType,
		);
		await user.type(panel.getByLabelText(/Equipment identifier/), "L-NEW");
		await user.selectOptions(
			panel.getByLabelText("Current employee"),
			ids.alex,
		);
		await user.type(panel.getByLabelText(/Actual handover date/), "2026-11-04");
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
		await waitFor(() =>
			expect(api.change).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "register_and_issue_individual",
					typeId: ids.laptopType,
					identifier: "L-NEW",
					employeeId: ids.alex,
					expectedRevision: 0,
				}),
			),
		);
		expect(api.toast.success).toHaveBeenCalledWith("Handover recorded.");
		expect(api.refresh).toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("requires an actual handover date, snapshots the selected type default, and retries the same handover identity", async () => {
		api.change.mockResolvedValue({ success: false, code: "DatabaseError" });
		const user = userEvent.setup();
		overview(view);
		const panel = await openPanel(user, "Issue equipment");
		await user.selectOptions(
			panel.getByLabelText(/^Equipment item/),
			ids.laptop,
		);
		const employeeSelect = panel.getByLabelText(/^Current employee/);
		await user.selectOptions(employeeSelect, ids.alex);
		expect(
			within(employeeSelect).queryByRole("option", { name: "Robin Former" }),
		).toBeNull();
		expect(
			(panel.getByLabelText("Return required") as HTMLInputElement).checked,
		).toBe(false);
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
		expect(
			await panel.findByText("Enter the actual handover date."),
		).toBeTruthy();
		expect(document.activeElement).toBe(
			panel.getByLabelText(/^Actual handover date/),
		);
		expect(api.change).not.toHaveBeenCalled();
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-04",
		);
		await user.selectOptions(panel.getByLabelText("Condition"), "worn");
		await user.type(panel.getByLabelText("Notes (optional)"), "With charger");
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
		await waitFor(() =>
			expect(api.toast.error).toHaveBeenCalledWith(
				"The handover could not be confirmed. Retry the unchanged form or reload equipment to check its history.",
			),
		);
		// An uncertain outcome keeps the panel open for an identical retry.
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
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
		expect(api.refresh).not.toHaveBeenCalled();
	});

	it("issues a positive whole quantity without requiring an artificial individual identity", async () => {
		api.change.mockResolvedValue({
			success: true,
			data: { ok: true, id: "new", revision: 1 },
		});
		const user = userEvent.setup();
		overview({
			...view,
			availableItems: [],
			availableQuantityTypes: [quantityType],
		});
		const panel = await openPanel(user, "Issue equipment");
		await user.selectOptions(
			panel.getByLabelText(/^Equipment item/),
			quantityType.id,
		);
		await user.selectOptions(
			panel.getByLabelText(/^Current employee/),
			ids.alex,
		);
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-04",
		);
		const quantity = panel.getByLabelText(/^Quantity/);
		await user.clear(quantity);
		await user.type(quantity, "1.5");
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
		expect(
			await panel.findByText("Enter a positive whole quantity."),
		).toBeTruthy();
		expect(document.activeElement).toBe(quantity);
		expect(api.change).not.toHaveBeenCalled();
		await user.clear(quantity);
		await user.type(quantity, "3");
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
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

	it("keeps individual issuance usable after correcting an invalid quantity by selecting an individual item", async () => {
		api.change.mockResolvedValue({
			success: true,
			data: { ok: true, id: "new", revision: 1 },
		});
		const user = userEvent.setup();
		overview({ ...view, availableQuantityTypes: [quantityType] });
		const panel = await openPanel(user, "Issue equipment");
		await user.selectOptions(
			panel.getByLabelText(/^Equipment item/),
			quantityType.id,
		);
		await user.selectOptions(
			panel.getByLabelText(/^Current employee/),
			ids.alex,
		);
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-04",
		);
		await user.clear(panel.getByLabelText(/^Quantity/));
		await user.type(panel.getByLabelText(/^Quantity/), "0");
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
		expect(
			await panel.findByText("Enter a positive whole quantity."),
		).toBeTruthy();
		await user.selectOptions(
			panel.getByLabelText(/^Equipment item/),
			ids.laptop,
		);
		expect(panel.queryByLabelText(/^Quantity/)).toBeNull();
		await user.click(panel.getByRole("button", { name: "Record issuance" }));
		await waitFor(() => expect(api.change).toHaveBeenCalled());
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "issue_individual",
			itemId: ids.laptop,
			expectedRevision: 3,
		});
		expect(api.change.mock.calls[0][0]).not.toHaveProperty("quantity");
	});

	it("records known historical quantities for a scoped former subject with an independent deadline", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		overview({
			...view,
			availableQuantityTypes: [
				{
					id: ids.laptopType,
					name: "Shirts",
					defaultReturnRequired: true,
					revision: 4,
				},
			],
		});
		const panel = await openHistorical(user);
		await user.selectOptions(
			panel.getByLabelText(/Equipment item/),
			ids.laptopType,
		);
		await user.selectOptions(
			panel.getByLabelText("Current or former employee"),
			ids.robin,
		);
		await user.clear(panel.getByLabelText(/Quantity/));
		await user.type(panel.getByLabelText(/Quantity/), "3");
		await user.type(panel.getByLabelText(/Actual handover date/), "2026-11-06");
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		expect(
			await panel.findByText(/actual handover date cannot be in the future/),
		).toBeTruthy();
		expect(api.change).not.toHaveBeenCalled();
		await user.clear(panel.getByLabelText(/Actual handover date/));
		await user.type(panel.getByLabelText(/Actual handover date/), "2026-08-01");
		await user.type(
			panel.getByLabelText(/Explicit return deadline/),
			"2026-10-01",
		);
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		await waitFor(() =>
			expect(api.change).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "record_historical_quantity",
					employeeId: ids.robin,
					quantity: 3,
					actualDate: "2026-08-01",
					explicitDeadline: "2026-10-01",
					returnRequired: true,
					expectedRevision: 4,
				}),
			),
		);
	});
});

describe("Row commands", () => {
	it("offers only the commands the reader may run on a row", async () => {
		const user = userEvent.setup();
		overview({
			...view,
			employees: [
				...view.employees,
				{ id: ids.jamie, name: "Jamie New", image: null, former: false },
			],
			assignments: [
				{
					...heldAssignment,
					canCloseException: true,
					transfer: {
						expectedIssuanceRevision: 4,
						defaultReturnRequired: false,
					},
				},
				{
					...heldAssignment,
					id: "15380000-0000-4000-8000-000000000035",
					identifier: "L-OWN",
					canReceive: false,
				},
			],
		});
		await user.click(screen.getByRole("button", { name: "Actions for L-02" }));
		const menu = within(await screen.findByRole("menu"));
		expect(
			menu.getAllByRole("menuitem").map((item) => item.textContent),
		).toEqual(["Record receipt", "Transfer", "Close return", "View details"]);
		await user.keyboard("{Escape}");
		await user.click(screen.getByRole("button", { name: "Actions for L-OWN" }));
		const own = within(await screen.findByRole("menu"));
		expect(
			own.getAllByRole("menuitem").map((item) => item.textContent),
		).toEqual(["View details"]);
	});

	it("records a dated receipt with its own condition and notes without leaving the list", async () => {
		api.change.mockResolvedValue({
			success: true,
			data: { ok: true, id: heldAssignment.id, revision: 8 },
		});
		const user = userEvent.setup();
		overview({ ...view, assignments: [heldAssignment] });
		const panel = await openRowAction(user, "L-02", "Record receipt");
		expect(
			panel.getByRole("heading", { name: "Confirm physical receipt" }),
		).toBeTruthy();
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-10-31",
		);
		await user.click(panel.getByRole("button", { name: "Record receipt" }));
		expect(
			await panel.findByText("Receipt cannot precede the recorded issuance."),
		).toBeTruthy();
		expect(api.change).not.toHaveBeenCalled();
		await user.clear(panel.getByLabelText(/^Actual handover date/));
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-04",
		);
		await user.selectOptions(panel.getByLabelText("Condition"), "damaged");
		await user.type(panel.getByLabelText("Notes (optional)"), "Cracked screen");
		await user.click(panel.getByRole("button", { name: "Record receipt" }));
		await waitFor(() => expect(api.refresh).toHaveBeenCalled());
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "receive_individual",
			assignmentId: heldAssignment.id,
			expectedRevision: 7,
			actualDate: "2026-11-04",
			condition: "damaged",
			notes: "Cracked screen",
		});
		expect(api.toast.success).toHaveBeenCalledWith("Handover recorded.");
		expect(api.push).not.toHaveBeenCalled();
	});

	it("caps a partial receipt at the physical balance", async () => {
		api.change.mockResolvedValue({
			success: true,
			data: { ok: true, id: partialAssignment.id, revision: 8 },
		});
		const user = userEvent.setup();
		overview({ ...view, assignments: [partialAssignment] });
		const row = screen.getAllByRole("row")[1];
		expect(row.textContent).toContain("1 / 3");
		const panel = await openRowAction(user, "Shirt size M", "Record receipt");
		await user.type(
			panel.getByLabelText(/^Actual handover date/),
			"2026-11-04",
		);
		const quantity = panel.getByLabelText(/^Quantity/);
		await user.clear(quantity);
		await user.type(quantity, "2");
		await user.click(panel.getByRole("button", { name: "Record receipt" }));
		expect(
			await panel.findByText(
				"Quantity exceeds the remaining physical balance.",
			),
		).toBeTruthy();
		expect(api.change).not.toHaveBeenCalled();
		await user.clear(quantity);
		await user.type(quantity, "1");
		await user.selectOptions(panel.getByLabelText("Condition"), "damaged");
		await user.type(panel.getByLabelText("Notes (optional)"), "Torn sleeve");
		await user.click(panel.getByRole("button", { name: "Record receipt" }));
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
});

describe("Employee equipment", () => {
	function employee(data: EquipmentView, employeeId: string) {
		return render(
			<EmployeeEquipment data={data} employeeId={employeeId} variant="page" />,
		);
	}

	it("heads the page with the holder and a summary, without a holder column", () => {
		employee(
			{
				...view,
				assignments: [
					heldAssignment,
					{
						...heldAssignment,
						id: "15380000-0000-4000-8000-000000000036",
						identifier: "L-03",
						overdue: false,
						effectiveDeadline: null,
					},
				],
			},
			ids.alex,
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Alex Current" }),
		).toBeTruthy();
		expect(screen.getByText("2 outstanding returns · 1 overdue")).toBeTruthy();
		expect(screen.queryByRole("columnheader", { name: /Holder/ })).toBeNull();
		expect(
			screen.getByRole("link", { name: "Back to equipment" }),
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Issue equipment" }),
		).toBeTruthy();
	});

	it("prefills the holder when issuing from the employee page", async () => {
		const user = userEvent.setup();
		employee(view, ids.alex);
		const panel = await openPanel(user, "Issue equipment");
		const holder = panel.getByLabelText(
			/^Current employee/,
		) as HTMLSelectElement;
		expect(holder.value).toBe(ids.alex);
		expect(holder.disabled).toBe(true);
	});

	it("keeps former employees usable for receipt and history without offering issuance", async () => {
		const user = userEvent.setup();
		employee(
			{
				...view,
				assignments: [
					{
						...heldAssignment,
						employeeId: ids.robin,
						holderName: "Robin Former",
						former: true,
					},
				],
			},
			ids.robin,
		);
		expect(
			screen.queryByRole("button", { name: "Issue equipment" }),
		).toBeNull();
		expect(screen.getByText("Former")).toBeTruthy();
		expect(
			screen.getByText(
				"Former employees remain available for returns, history and recording existing holdings. New issuance is unavailable.",
			),
		).toBeTruthy();
		expect(await openRowAction(user, "L-02", "Record receipt")).toBeTruthy();
	});

	it("keeps historical follow-up available without offering fresh issuance outside current scope", () => {
		employee(
			{ ...view, employees: [{ ...view.employees[0], canIssue: false }] },
			ids.alex,
		);
		expect(
			screen.queryByRole("button", { name: "Issue equipment" }),
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Record existing holding" }),
		).toBeTruthy();
	});

	it("records an explicitly unknown historical holding for a former employee and preserves retry identity", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: false, code: "DatabaseError" });
		employee(view, ids.robin);
		expect(
			screen.queryByRole("button", { name: "Issue equipment" }),
		).toBeNull();
		const panel = await openPanel(user, "Record existing holding");
		expect(
			panel.getByText(/Entry time and recorder are saved separately/),
		).toBeTruthy();
		await user.selectOptions(
			panel.getByLabelText(/Equipment item/),
			ids.laptop,
		);
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		expect(
			await panel.findByText("Enter the actual handover date."),
		).toBeTruthy();
		await user.click(panel.getByLabelText("Actual issue date is unknown"));
		expect(panel.queryByLabelText(/Actual handover date/)).toBeNull();
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
		expect(api.change.mock.calls[0][0]).toMatchObject({
			kind: "record_historical_individual",
			actualDate: null,
			employeeId: ids.robin,
			condition: "unknown",
			returnRequired: false,
			explicitDeadline: null,
		});
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
		expect(api.change.mock.calls[1][0]).toEqual(api.change.mock.calls[0][0]);
	});

	it("requires the original employment period for ambiguous historical holdings after rehire", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		const oldPeriod = "15370000-0000-4000-8000-000000000050";
		employee(
			{
				...view,
				employmentPeriods: [
					{
						id: oldPeriod,
						employeeId: ids.alex,
						startedOn: "2025-01-01",
						endedOn: "2026-05-01",
					},
					{
						id: "15370000-0000-4000-8000-000000000051",
						employeeId: ids.alex,
						startedOn: "2026-10-01",
						endedOn: null,
					},
				],
			},
			ids.alex,
		);
		const panel = await openHistorical(user);
		await user.selectOptions(
			panel.getByLabelText(/Equipment item/),
			ids.laptop,
		);
		await user.click(panel.getByLabelText("Actual issue date is unknown"));
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		expect(
			await panel.findByText("Select the original employment period."),
		).toBeTruthy();
		expect(api.change).not.toHaveBeenCalled();
		await user.selectOptions(
			panel.getByLabelText(/Original employment period/),
			oldPeriod,
		);
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		await waitFor(() =>
			expect(api.change).toHaveBeenCalledWith(
				expect.objectContaining({
					kind: "record_historical_individual",
					actualDate: null,
					employmentPeriodId: oldPeriod,
				}),
			),
		);
	});

	const contexts = [
		{
			id: "15370000-0000-4000-8000-000000000099",
			employeeId: ids.alex,
			employmentPeriodId: null,
			startedOn: null,
			endedOn: "2026-10-20",
		},
		{
			id: "current",
			employeeId: ids.alex,
			employmentPeriodId: null,
			startedOn: "2026-10-22",
			endedOn: null,
		},
	];

	it("requires an explicit ending for an unknown date in a reopened historical period", async () => {
		const user = userEvent.setup();
		api.change.mockResolvedValue({ success: true, data: { ok: true } });
		employee({ ...view, historicalContexts: contexts }, ids.alex);
		const panel = await openHistorical(user);
		await user.selectOptions(
			panel.getByLabelText(/Equipment item/),
			ids.laptop,
		);
		await user.click(panel.getByLabelText("Actual issue date is unknown"));
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		expect(
			await panel.findByText(
				"Select the original ending or current employment context.",
			),
		).toBeTruthy();
		expect(api.change).not.toHaveBeenCalled();
		await user.selectOptions(
			panel.getByLabelText("Original ending or current context"),
			contexts[0].id,
		);
		await user.click(
			panel.getByRole("button", { name: "Save historical holding" }),
		);
		await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
		expect(api.change.mock.calls[0][0]).toMatchObject({
			actualDate: null,
			endingContext: contexts[0].id,
		});
	});

	it.each(["2026-10-19", "2026-10-22"])(
		"submits known historical handover %s for server chronology selection",
		async (actualDate) => {
			const user = userEvent.setup();
			api.change.mockResolvedValue({ success: true, data: { ok: true } });
			employee({ ...view, historicalContexts: contexts }, ids.alex);
			const panel = await openHistorical(user);
			await user.selectOptions(
				panel.getByLabelText(/Equipment item/),
				ids.laptop,
			);
			await user.type(panel.getByLabelText(/Actual handover date/), actualDate);
			await user.click(
				panel.getByRole("button", { name: "Save historical holding" }),
			);
			await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
			expect(api.change.mock.calls[0][0]).toMatchObject({ actualDate });
			expect(api.change.mock.calls[0][0]).not.toHaveProperty("endingContext");
		},
	);

	it("embeds as a profile section with its own heading", () => {
		render(
			<EmployeeEquipment
				data={{ ...view, assignments: [heldAssignment] }}
				employeeId={ids.alex}
			/>,
		);
		expect(screen.getByRole("region", { name: "Equipment" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { level: 2, name: "Equipment" }),
		).toBeTruthy();
		expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
		expect(screen.getByText("1 outstanding return · 1 overdue")).toBeTruthy();
	});
});
