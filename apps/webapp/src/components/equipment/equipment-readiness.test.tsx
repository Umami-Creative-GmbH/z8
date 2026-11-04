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
	EquipmentReadinessItemView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { EquipmentOverview, PersonalEquipment } from "./equipment-workspace";

const api = vi.hoisted(() => ({ change: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipment: api.change,
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: api.refresh }),
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
	canManage: true,
	canAdminister: true,
	registrationTypes: [],
	policyConfigured: true,
	timezone: "Europe/Berlin",
	today: "2026-11-05",
	employees: [],
	types: [],
	assignments: [],
	availableItems: [],
	readinessItems: [damaged],
};
it("confirms explicit clearance, keeps uncertain retries identical and shows stale conflicts with reload guidance", async () => {
	api.change.mockResolvedValueOnce({ success: false }).mockResolvedValue({
		success: true,
		data: { ok: false, reason: "stale_revision" },
	});
	const user = userEvent.setup();
	render(<EquipmentOverview data={view} filters={{}} />);
	await user.click(screen.getByRole("button", { name: "Clear for issue" }));
	expect(
		screen.getByText(/Receipt condition and history stay unchanged/),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Confirm clearance" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Confirm clearance" }));
	await waitFor(() => expect(api.change).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[0][0]).toEqual(api.change.mock.calls[1][0]);
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "clear_item",
		itemId: damaged.id,
		expectedRevision: 3,
	});
	expect(
		await screen.findByText(/This record changed. Reload equipment/),
	).toBeTruthy();
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
	render(<EquipmentOverview data={data} filters={{}} />);
	const retired = screen.getByRole("article", { name: "L-RETIRED" });
	expect(within(retired).getByText("Retired")).toBeTruthy();
	expect(within(retired).queryByRole("button")).toBeNull();
	const held = screen.getByRole("article", { name: "L-HELD" });
	expect(within(held).getByText("Held by employee")).toBeTruthy();
	expect(
		within(held).queryByRole("button", { name: "Clear for issue" }),
	).toBeNull();
	const cleared = screen.getByRole("article", { name: "L-CLEARED" });
	await user.click(within(cleared).getByText("Availability history"));
	expect(within(cleared).getByText(/Sam Officer/)).toBeTruthy();
	expect(within(cleared).getByText(/Nov 5, 2026/)).toBeTruthy();
	expect(within(cleared).getByText("Europe/Berlin")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Issue equipment" }));
	const selection = screen.getByLabelText(/^Equipment item/);
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
	const { rerender } = render(
		<EquipmentOverview
			data={{ ...view, readinessItems: [available] }}
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Mark unavailable" }));
	await user.click(screen.getByRole("button", { name: "Confirm unavailable" }));
	await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(1));
	expect(api.change.mock.calls[0][0]).toMatchObject({
		kind: "mark_item_unavailable",
		itemId: damaged.id,
		expectedRevision: 3,
	});
	rerender(
		<EquipmentOverview
			data={{ ...view, readinessItems: [{ ...damaged, revision: 4 }] }}
			filters={{}}
		/>,
	);
	await user.click(screen.getByRole("button", { name: "Retire item" }));
	expect(
		screen.getByText(/Retirement is permanent. The identifier stays reserved/),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Cancel" }));
	expect(api.change).toHaveBeenCalledTimes(1);
	await user.click(screen.getByRole("button", { name: "Retire item" }));
	await user.click(screen.getByRole("button", { name: "Confirm retirement" }));
	await waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(2));
	expect(api.change.mock.calls[1][0]).toMatchObject({
		kind: "retire_item",
		expectedRevision: 4,
	});
});

it("keeps personal history free of item management controls", () => {
	render(
		<PersonalEquipment
			data={{ ...view, canManage: false, readinessItems: [] }}
		/>,
	);
	expect(
		screen.queryByRole("region", { name: "Item availability" }),
	).toBeNull();
	expect(screen.queryByRole("button", { name: "Clear for issue" })).toBeNull();
});
