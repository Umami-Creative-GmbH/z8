// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type {
	EquipmentAssignmentView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { PersonalEquipment } from "./equipment-workspace";
import {
	heldAssignment,
	issue,
	partialAssignment,
	stubLayoutApis,
	view,
} from "./testing/equipment-view.test-fixture";

vi.mock("@/lib/organization/equipment/actions", () => ({
	changeEquipment: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(stubLayoutApis);
afterEach(cleanup);

const personal: EquipmentView = {
	...view,
	canManage: false,
	canAdminister: false,
	availableItems: [],
	employees: [],
	types: [],
};
const own = (
	patch: Partial<EquipmentAssignmentView>,
): EquipmentAssignmentView => ({
	...heldAssignment,
	canReceive: false,
	...patch,
});
const returned = own({
	id: "returned",
	identifier: "L-RETURNED",
	physicallyReceivedQuantity: 1,
	outstandingQuantity: 0,
	outstanding: false,
	overdue: false,
	held: false,
	receipts: [
		{
			...issue,
			id: "receipt",
			actualDate: "2026-11-04",
			condition: "damaged",
			notes: "Cracked screen",
			actorId: "admin",
			actorName: "Sam Admin",
			recordedAt: "2026-11-05T10:00:00Z",
		},
	],
});
returned.receipt = returned.receipts[0];

function renderPersonal(assignments: EquipmentAssignmentView[]) {
	return render(<PersonalEquipment data={{ ...personal, assignments }} />);
}

it("groups the employee's own equipment as to return, yours to keep, and returned and closed", () => {
	renderPersonal([
		own({
			id: "keep",
			identifier: "GLOVES",
			returnRequired: false,
			outstanding: false,
			overdue: false,
			effectiveDeadline: null,
			explicitDeadline: null,
		}),
		returned,
		own({
			id: "soon",
			identifier: "PH-01",
			overdue: false,
			effectiveDeadline: "2026-11-09",
		}),
		heldAssignment,
	]);
	expect(
		screen.getByRole("heading", { level: 1, name: "My equipment" }),
	).toBeTruthy();
	expect(
		screen
			.getAllByRole("heading", { level: 2 })
			.map((heading) => heading.textContent),
	).toEqual(["To return", "Yours to keep", "Returned & closed"]);
	const toReturn = screen
		.getByRole("heading", { name: "To return" })
		.closest("[data-slot=card]") as HTMLElement;
	const rows = within(toReturn).getAllByRole("button");
	expect(
		rows.map((row) => within(row).getByText(/L-02|PH-01/).textContent),
	).toEqual(["L-02", "PH-01"]);
	expect(within(rows[0]).getByText("1 day overdue")).toBeTruthy();
	expect(within(rows[1]).getByText("in 4 days")).toBeTruthy();
	expect(screen.getByText("Issued to keep")).toBeTruthy();
	expect(screen.getByText("Physically received")).toBeTruthy();
});

it("keeps personal history read-only and shows returned condition separately from issuance evidence", async () => {
	const user = userEvent.setup();
	renderPersonal([returned]);
	expect(screen.queryByText("Cracked screen")).toBeNull();
	await user.click(screen.getByRole("button", { name: /L-RETURNED/ }));
	expect(await screen.findByText("Cracked screen")).toBeTruthy();
	expect(screen.getByText("Sam Admin")).toBeTruthy();
	expect(screen.getByText("Pat Owner")).toBeTruthy();
	expect(screen.getByText(/Quantity: 1 · Damaged/)).toBeTruthy();
	expect(screen.getByText(/Quantity: 1 · Good/)).toBeTruthy();
	for (const name of [
		"Issue equipment",
		"Record receipt",
		"Transfer",
		"Close return",
	])
		expect(screen.queryByRole("button", { name })).toBeNull();
	expect(screen.queryByRole("button", { name: "Correct a record" })).toBeNull();
});

it("keeps all partial receipts visible on personal history", async () => {
	const user = userEvent.setup();
	renderPersonal([
		{
			...partialAssignment,
			canReceive: false,
			receipts: [
				...partialAssignment.receipts,
				{
					...issue,
					id: "last",
					quantity: 1,
					condition: "damaged",
					actualDate: "2026-11-04",
					notes: "One torn shirt",
					recordedAt: "2026-11-05T10:00:00Z",
				},
			],
			physicallyReceivedQuantity: 3,
			outstandingQuantity: 0,
			held: false,
			outstanding: false,
			overdue: false,
		},
	]);
	await user.click(screen.getByRole("button", { name: /Shirt size M/ }));
	expect(await screen.findByText("Two shirts back")).toBeTruthy();
	expect(screen.getByText("One torn shirt")).toBeTruthy();
	expect(
		screen.getByText("Outstanding quantity").nextElementSibling?.textContent,
	).toBe("0");
});

it("displays unknown historical dates separately from attributable entry time", async () => {
	const user = userEvent.setup();
	renderPersonal([
		own({ issue: { ...issue, actualDate: null, historical: true } }),
	]);
	await user.click(screen.getByRole("button", { name: /L-02/ }));
	expect(await screen.findByText("Actual issue date unknown")).toBeTruthy();
	expect(screen.getByText(/Historical issuance/)).toBeTruthy();
	expect(screen.getByText("Pat Owner")).toBeTruthy();
	const times = [...document.querySelectorAll("time")].map((element) =>
		element.getAttribute("dateTime"),
	);
	expect(times).toContain("2026-11-02T12:00:00Z");
	expect(times).not.toContain("2026-11-02");
	expect(
		screen.queryByRole("button", { name: "Record existing holding" }),
	).toBeNull();
});

it("shows original and amended evidence with attribution in personal read-only history", async () => {
	const user = userEvent.setup();
	const correction = {
		id: "correction",
		handoverId: issue.id,
		exceptionId: null,
		expectedRevision: 6,
		reason: "Signed agreement corrected the condition",
		actorId: "admin",
		actorName: "Sam Admin",
		recordedAt: "2026-11-05T09:00:00Z",
		before: {
			quantity: 1,
			condition: "good",
			notes: "Original signed evidence",
			actualDate: "2026-11-01",
		},
		after: {
			quantity: 1,
			condition: "worn",
			notes: "Effective signed evidence",
			actualDate: "2026-11-02",
		},
	};
	renderPersonal([own({ corrections: [correction] })]);
	await user.click(screen.getByRole("button", { name: /L-02/ }));
	expect(await screen.findByText("Amended")).toBeTruthy();
	await user.click(
		screen.getByText("Original records and amendments", {
			selector: "summary",
		}),
	);
	expect(screen.getByText("Original signed evidence")).toBeTruthy();
	expect(screen.getByText("Effective signed evidence")).toBeTruthy();
	expect(screen.getByText(correction.reason)).toBeTruthy();
	expect(screen.getAllByText(/Sam Admin/).length).toBeGreaterThan(0);
});

it("explains an empty record", () => {
	renderPersonal([]);
	expect(screen.getByText("No equipment recorded")).toBeTruthy();
	expect(screen.queryByRole("heading", { name: "To return" })).toBeNull();
});
