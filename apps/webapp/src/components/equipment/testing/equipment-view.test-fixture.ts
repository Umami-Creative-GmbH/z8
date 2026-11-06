import { vi } from "vitest";
import type {
	EquipmentAssignmentView,
	EquipmentHandoverView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";

/** jsdom lacks the layout APIs the searchable select and menus call. */
export function stubLayoutApis() {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
}

/**
 * Shared read-model fixtures and a translation stub for the equipment component
 * tests. The stub renders the English default and resolves ICU `{name}` and
 * `{count, plural, …}` placeholders the way the surfaces use them.
 */
export function translate(
	_key: string,
	fallback: string,
	params?: Record<string, unknown>,
) {
	if (!params) return fallback;
	return fallback
		.replace(
			/\{(\w+), plural, ((?:[^{}]|\{[^{}]*\})*)\}/g,
			(_match, name: string, body: string) => {
				const count = Number(params[name]);
				const cases = Object.fromEntries(
					[...body.matchAll(/(=\d+|\w+) \{([^{}]*)\}/g)].map((match) => [
						match[1],
						match[2],
					]),
				);
				const chosen =
					cases[`=${count}`] ??
					(count === 1 ? cases.one : undefined) ??
					cases.other ??
					"";
				return chosen.replace(/#/g, String(count));
			},
		)
		.replace(/\{(\w+)\}/g, (match, name: string) =>
			name in params ? String(params[name]) : match,
		);
}

export const ids = {
	alex: "15370000-0000-4000-8000-000000000001",
	robin: "15370000-0000-4000-8000-000000000002",
	jamie: "15370000-0000-4000-8000-000000000003",
	laptopType: "15370000-0000-4000-8000-000000000010",
	shirtType: "15380000-0000-4000-8000-000000000010",
	laptop: "15370000-0000-4000-8000-000000000020",
	assignment: "15370000-0000-4000-8000-000000000030",
} as const;

export const view: EquipmentView = {
	readinessItems: [],
	canManage: true,
	canAdminister: true,
	registrationTypes: [],
	policyConfigured: true,
	timezone: "Europe/Berlin",
	today: "2026-11-05",
	employees: [
		{ id: ids.alex, name: "Alex Current", image: null, former: false },
		{ id: ids.robin, name: "Robin Former", image: null, former: true },
	],
	types: [{ id: ids.laptopType, name: "Laptop" }],
	availableQuantityTypes: [],
	availableItems: [
		{
			id: ids.laptop,
			typeId: ids.laptopType,
			typeName: "Laptop",
			identifier: "L-01",
			defaultReturnRequired: false,
			revision: 3,
		},
	],
	assignments: [],
};

export const issue: EquipmentHandoverView = {
	id: "issue",
	exceptionId: null,
	quantity: 1,
	actualDate: "2026-11-01",
	condition: "good",
	notes: "Initial handover",
	actorId: "owner",
	actorName: "Pat Owner",
	recordedAt: "2026-11-02T12:00:00Z",
};

/** An identified laptop held by Alex, overdue since November 4. */
export const heldAssignment: EquipmentAssignmentView = {
	lostQuantity: 0,
	waivedQuantity: 0,
	recoveredQuantity: 0,
	exceptions: [],
	canCloseException: false,
	trackingMode: "individual",
	quantity: 1,
	physicallyReceivedQuantity: 0,
	outstandingQuantity: 1,
	receipts: [],
	id: ids.assignment,
	itemId: ids.laptop,
	typeId: ids.laptopType,
	typeName: "Laptop",
	identifier: "L-02",
	serialNumber: null,
	employeeId: ids.alex,
	holderName: "Alex Current",
	holderImage: null,
	former: false,
	returnRequired: true,
	explicitDeadline: "2026-11-04",
	departureDeadline: null,
	effectiveDeadline: "2026-11-04",
	employmentPeriodId: null,
	departureId: null,
	deactivationId: null,
	outstanding: true,
	overdue: true,
	held: true,
	revision: 7,
	canReceive: true,
	issue,
	receipt: null,
};

export const quantityType = {
	id: ids.shirtType,
	name: "Shirt size M",
	defaultReturnRequired: true,
	revision: 2,
};

/** Three shirts, two physically received, one still outstanding. */
export const partialAssignment: EquipmentAssignmentView = {
	...heldAssignment,
	itemId: null,
	trackingMode: "quantity",
	quantity: 3,
	physicallyReceivedQuantity: 2,
	outstandingQuantity: 1,
	identifier: quantityType.name,
	typeId: quantityType.id,
	typeName: quantityType.name,
	issue: { ...issue, quantity: 3 },
	receipts: [
		{
			...issue,
			id: "partial",
			quantity: 2,
			actualDate: "2026-11-03",
			notes: "Two shirts back",
			actorId: "admin",
			actorName: "Sam Admin",
			recordedAt: "2026-11-04T10:00:00Z",
		},
	],
	receipt: {
		...issue,
		id: "partial",
		quantity: 2,
		actualDate: "2026-11-03",
		notes: "Two shirts back",
		actorId: "admin",
		actorName: "Sam Admin",
		recordedAt: "2026-11-04T10:00:00Z",
	},
};
