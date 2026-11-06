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
import type {
	EquipmentReadinessItemView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { DEFAULT_EQUIPMENT_LIST_QUERY } from "./equipment-list-state";
import { EquipmentOverview, PersonalEquipment } from "./equipment-workspace";
import {
	view as baseView,
	stubLayoutApis,
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

const damaged: EquipmentReadinessItemView = {
	id: "15410000-0000-4000-8000-000000000001",
	typeId: "15410000-0000-4000-8000-000000000002",
	typeName: "Laptop",
	identifier: "L-DAMAGED",
	serialNumber: null,
	status: "unavailable",
	inCustody: false,
	archived: false,
	revision: 3,
	canClear: true,
	canMarkUnavailable: false,
	canRetire: true,
	history: [],
};
const view: EquipmentView = {
	...baseView,
	employees: [],
	types: [{ id: damaged.typeId, name: "Laptop" }],
	availableItems: [],
	readinessItems: [damaged],
};
type User = ReturnType<typeof userEvent.setup>;

async function openItems(user: User, data: EquipmentView) {
	const result = render(
		<EquipmentOverview data={data} query={DEFAULT_EQUIPMENT_LIST_QUERY} />,
	);
	await user.click(screen.getByRole("tab", { name: "Items" }));
	return result;
}
function itemRow(identifier: string) {
	const row = screen
		.getAllByRole("row")
		.find((candidate) => within(candidate).queryByText(identifier));
	if (!row) throw new Error(`No row for ${identifier}`);
	return row;
}
async function itemMenu(user: User, identifier: string) {
	await user.click(
		screen.getByRole("button", { name: `Actions for ${identifier}` }),
	);
	return within(await screen.findByRole("menu"));
}
async function decide(user: User, identifier: string, action: string) {
	const menu = await itemMenu(user, identifier);
	await user.click(menu.getByRole("menuitem", { name: action }));
	return within(await screen.findByRole("alertdialog"));
}

it("explains cleaned personal history while keeping physical custody and readiness controls independent", async () => {
	const user = userEvent.setup();
	await openItems(user, {
		...view,
		readinessItems: [
			{
				...damaged,
				inCustody: true,
				personalHistoryCleaned: true,
				canClear: false,
			},
		],
	});
	expect(
		within(itemRow("L-DAMAGED")).getByText("Held by employee"),
	).toBeTruthy();
	const menu = await itemMenu(user, "L-DAMAGED");
	expect(menu.queryByRole("menuitem", { name: "Clear for issue" })).toBeNull();
	await user.click(
		menu.getByRole("menuitem", { name: "Availability history" }),
	);
	const panel = within(await screen.findByRole("dialog"));
	expect(
		panel.getByText(
			"Expired personal history was removed. Item identity, custody and availability remain recorded; cleanup does not confirm physical receipt.",
		),
	).toBeTruthy();
});

it("confirms explicit clearance, keeps uncertain retries identical and shows stale conflicts with reload guidance", async () => {
	api.change.mockResolvedValueOnce({ success: false }).mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const user = userEvent.setup();
	await openItems(user, view);
	const dialog = await decide(user, "L-DAMAGED", "Clear for issue");
	expect(
		dialog.getByText(/Receipt condition and history stay unchanged/),
	).toBeTruthy();
	await user.click(dialog.getByRole("button", { name: "Confirm clearance" }));
	await waitFor(() => expect(api.toast.error).toHaveBeenCalledTimes(1));
	await user.click(dialog.getByRole("button", { name: "Confirm clearance" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[0][0]).toEqual(api.change.mock.calls[1][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "clear_item",
		itemId: damaged.id,
		expectedRevision: 3,
	});
	await waitFor(() =>
		expect(api.toast.error).toHaveBeenLastCalledWith(
			expect.stringMatching(/This record changed. Reload equipment/),
		),
	);
	expect(screen.getByRole("alertdialog")).toBeTruthy();
});

it("keeps retired and held items out of issue selection and shows distinct readiness, custody and clearance evidence", async () => {
	const user = userEvent.setup();
	const available = {
		...damaged,
		id: "15410000-0000-4000-8000-000000000003",
		identifier: "L-READY",
		status: "available" as const,
		canClear: false,
		canMarkUnavailable: true,
		revision: 4,
	};
	const data: EquipmentView = {
		...view,
		employees: [
			{
				id: "15410000-0000-4000-8000-000000000004",
				name: "Alex Current",
				image: null,
				former: false,
			},
		],
		availableItems: [
			{
				id: available.id,
				identifier: available.identifier,
				typeId: available.typeId,
				typeName: available.typeName,
				defaultReturnRequired: true,
				revision: available.revision,
			},
		],
		readinessItems: [
			damaged,
			available,
			{
				...damaged,
				id: "retired",
				identifier: "L-RETIRED",
				status: "retired",
				canClear: false,
				canRetire: false,
			},
			{
				...damaged,
				id: "held",
				identifier: "L-HELD",
				inCustody: true,
				canClear: false,
			},
			{
				...available,
				id: "cleared",
				identifier: "L-CLEARED",
				history: [
					{
						id: "clearance-event",
						kind: "clearance",
						actorId: "officer",
						actorName: "Sam Officer",
						recordedAt: "2026-11-04T23:30:00Z",
					},
				],
			},
		],
	};
	await openItems(user, data);
	// Opens on what needs attention: the damaged item awaiting a decision.
	expect(
		screen
			.getByRole("radio", { name: /Needs attention/ })
			.getAttribute("aria-checked"),
	).toBe("true");
	expect(screen.getAllByRole("row")).toHaveLength(2);
	await user.click(screen.getByRole("radio", { name: "All" }));
	expect(within(itemRow("L-RETIRED")).getByText("Retired")).toBeTruthy();
	const retiredMenu = await itemMenu(user, "L-RETIRED");
	expect(
		retiredMenu.getAllByRole("menuitem").map((item) => item.textContent),
	).toEqual(["Availability history"]);
	await user.keyboard("{Escape}");
	expect(within(itemRow("L-HELD")).getByText("Held by employee")).toBeTruthy();
	const heldMenu = await itemMenu(user, "L-HELD");
	expect(
		heldMenu.queryByRole("menuitem", { name: "Clear for issue" }),
	).toBeNull();
	await user.keyboard("{Escape}");
	expect(within(itemRow("L-CLEARED")).getByText("Nov 5, 2026")).toBeTruthy();
	const clearedMenu = await itemMenu(user, "L-CLEARED");
	await user.click(
		clearedMenu.getByRole("menuitem", { name: "Availability history" }),
	);
	const history = within(await screen.findByRole("dialog"));
	expect(history.getByText(/Sam Officer/)).toBeTruthy();
	expect(history.getByText(/Nov 5, 2026/)).toBeTruthy();
	expect(history.getByText("Europe/Berlin")).toBeTruthy();
	// The footer button; the panel's corner button has the same name.
	await user.click(history.getAllByRole("button", { name: "Close" })[0]);
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await user.click(
		screen.getAllByRole("button", { name: "Issue equipment" })[0],
	);
	const issue = within(await screen.findByRole("dialog"));
	const selection = issue.getByLabelText(/^Equipment item/);
	expect(
		within(selection).getByRole("option", { name: /L-READY/ }),
	).toBeTruthy();
	for (const identifier of ["L-DAMAGED", "L-RETIRED", "L-HELD"])
		expect(
			within(selection).queryByRole("option", { name: new RegExp(identifier) }),
		).toBeNull();
});

it("confirms unavailable and permanent retirement controls, preserving revisions and refreshing the authorized read", async () => {
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	const user = userEvent.setup();
	const available = {
		...damaged,
		status: "available" as const,
		canClear: false,
		canMarkUnavailable: true,
	};
	const { rerender } = await openItems(user, {
		...view,
		readinessItems: [available],
	});
	const unavailable = await decide(user, "L-DAMAGED", "Mark unavailable");
	await user.click(
		unavailable.getByRole("button", { name: "Confirm unavailable" }),
	);
	await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1));
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "mark_item_unavailable",
		itemId: damaged.id,
		expectedRevision: 3,
	});
	expect(api.toast.success).toHaveBeenCalledWith(
		"Availability decision recorded.",
	);
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	rerender(
		<EquipmentOverview
			data={{ ...view, readinessItems: [{ ...damaged, revision: 4 }] }}
			query={DEFAULT_EQUIPMENT_LIST_QUERY}
		/>,
	);
	let retire = await decide(user, "L-DAMAGED", "Retire item");
	expect(
		retire.getByText(/Retirement is permanent. The identifier stays reserved/),
	).toBeTruthy();
	await user.click(retire.getByRole("button", { name: "Cancel" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(api.change).toHaveBeenCalledTimes(1);
	retire = await decide(user, "L-DAMAGED", "Retire item");
	await user.click(retire.getByRole("button", { name: "Confirm retirement" }));
	await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toMatchObject({
		kind: "retire_item",
		expectedRevision: 4,
	});
});

it("opens the available items from the Items ready to issue figure", async () => {
	const user = userEvent.setup();
	render(
		<EquipmentOverview
			data={{
				...view,
				readinessItems: [
					damaged,
					{
						...damaged,
						id: "ready",
						identifier: "L-READY",
						status: "available",
					},
				],
			}}
			query={DEFAULT_EQUIPMENT_LIST_QUERY}
		/>,
	);
	expect(screen.getByText("Of 2 identified items")).toBeTruthy();
	await user.click(
		screen.getByRole("button", { name: "Show items ready to issue" }),
	);
	expect(
		screen.getByRole("tab", { name: "Items" }).getAttribute("aria-selected"),
	).toBe("true");
	expect(
		screen
			.getByRole("radio", { name: /Available/ })
			.getAttribute("aria-checked"),
	).toBe("true");
	expect(screen.getAllByRole("row")).toHaveLength(2);
	expect(screen.getByText("L-READY")).toBeTruthy();
});

it("offers no Items tab without identified items and keeps personal history free of item management controls", () => {
	const { rerender } = render(
		<EquipmentOverview
			data={{ ...view, readinessItems: [] }}
			query={DEFAULT_EQUIPMENT_LIST_QUERY}
		/>,
	);
	expect(screen.queryByRole("tab", { name: "Items" })).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Show items ready to issue" }),
	).toBeNull();
	rerender(
		<PersonalEquipment
			data={{ ...view, canManage: false, readinessItems: [] }}
		/>,
	);
	expect(screen.queryByText("Item availability")).toBeNull();
	expect(screen.queryByRole("button", { name: /Actions for/ })).toBeNull();
});

it("proposes a dated anonymous custody receipt from the items card", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	await openItems(user, {
		...view,
		readinessItems: [
			{
				...damaged,
				inCustody: true,
				canClear: false,
				personalHistoryCleaned: true,
				canProposeCustodyReceipt: true,
			},
		],
	});
	expect(
		screen.getByText("Anonymous custody receipts awaiting confirmation: 0"),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Review receipts" }));
	const panel = within(await screen.findByRole("dialog"));
	await user.click(
		panel.getByRole("button", { name: "Propose physical receipt" }),
	);
	await user.click(
		panel.getByRole("button", { name: "Record receipt proposal" }),
	);
	expect(
		await panel.findByText("Enter the actual handover date."),
	).toBeTruthy();
	await user.type(panel.getByLabelText(/Actual handover date/), "2026-11-04");
	await user.selectOptions(panel.getByLabelText("Condition"), "damaged");
	await user.click(
		panel.getByRole("button", { name: "Record receipt proposal" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "propose_custody_receipt",
		itemId: damaged.id,
		actualDate: "2026-11-04",
		condition: "damaged",
		expectedRevision: 3,
	});
	await waitFor(() =>
		expect(api.toast.success).toHaveBeenCalledWith(
			"Receipt evidence recorded. Reloading equipment…",
		),
	);
	expect(api.refresh).toHaveBeenCalled();
});

it("offers anonymous receipt confirmation only to an independent authorized actor", async () => {
	const user = userEvent.setup();
	api.change.mockResolvedValue({ success: true, data: { ok: true } });
	const receipt = {
		id: "15410000-0000-4000-8000-000000000099",
		actualDate: "2026-11-04",
		condition: "damaged" as const,
		proposedBy: "first",
		proposedAt: "2026-11-04T12:00:00Z",
		confirmedBy: null,
		confirmedAt: null,
		canConfirm: true,
	};
	const item = {
		...damaged,
		inCustody: true,
		canClear: false,
		custodyReceipt: receipt,
	};
	const { rerender } = await openItems(user, {
		...view,
		readinessItems: [item],
	});
	expect(
		screen.getByText("Anonymous custody receipts awaiting confirmation: 1"),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Review receipts" }));
	const panel = within(await screen.findByRole("dialog"));
	expect(
		panel.getByText(/A different authorized staff member must confirm/),
	).toBeTruthy();
	await user.click(
		panel.getByRole("button", { name: "Confirm physical receipt" }),
	);
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(1));
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "confirm_custody_receipt",
		itemId: damaged.id,
		proposalId: receipt.id,
		expectedRevision: 3,
	});
	rerender(
		<EquipmentOverview
			data={{
				...view,
				readinessItems: [
					{ ...item, custodyReceipt: { ...receipt, canConfirm: false } },
				],
			}}
			query={DEFAULT_EQUIPMENT_LIST_QUERY}
		/>,
	);
	expect(
		screen.queryByRole("button", { name: "Confirm physical receipt" }),
	).toBeNull();
});
