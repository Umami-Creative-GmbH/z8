import { describe, expect, it } from "vitest";
import { groupChangedWork } from "./changed-work-groups";
import type {
	AmountDifferenceView,
	ComparedWorkValuesView,
	MarkedWorkDraftView,
	MarkedWorkItemView,
} from "./views";

const values: ComparedWorkValuesView = {
	removed: false,
	pieceCount: 1,
	removedPieceCount: 0,
	day: "2026-03-02",
	start: { at: "2026-03-02T08:00:00.000Z", offsetMinutes: 60 },
	end: { at: "2026-03-02T10:00:00.000Z", offsetMinutes: 60 },
	durationMinutes: 120,
	hours: "2.00",
	projects: [{ id: "p-web", name: "Website" }],
	customers: [{ id: "c-acme", name: "Acme" }],
	billability: "billable",
};

const acmeMarch: MarkedWorkDraftView = {
	customerId: "c-acme",
	customerName: "Acme",
	currency: "EUR",
	period: { from: "2026-03-01", to: "2026-03-31" },
	title: "Acme March",
	createdAt: "2026-04-01T09:00:00.000Z",
};
const acmeApril: MarkedWorkDraftView = {
	...acmeMarch,
	period: { from: "2026-04-01", to: "2026-04-30" },
	title: "Acme April",
	createdAt: "2026-05-01T09:00:00.000Z",
};
const betaMarch: MarkedWorkDraftView = {
	...acmeMarch,
	customerId: "c-beta",
	customerName: "Beta",
	currency: "CHF",
	title: "Beta March",
};

function item(
	id: string,
	draftId: string,
	draft: MarkedWorkDraftView,
	changedAt: string,
	fromHandOff: AmountDifferenceView,
	sinceResolution: AmountDifferenceView | null = null,
): MarkedWorkItemView {
	return {
		invoicedWorkId: id,
		workPeriodId: `wp-${id}`,
		day: "2026-03-02",
		employeeName: "Grace",
		projectName: "Website",
		hours: "2.00",
		carried: false,
		changedAfterInvoicingAt: changedAt,
		changedFields: ["times"],
		invoiceDraftId: draftId,
		draft,
		markVersion: `${id}:1`,
		history: [],
		comparison: {
			amountDifference: {
				currency: draft.currency,
				fromHandOff,
				sinceResolution,
				notOnHandOffForNewCustomer: false,
			},
			handOff: values,
			lastResolved: null,
			current: { ...values, changedFromHandOff: [], changedSinceResolution: null },
		},
	};
}

const known = (amount: string): AmountDifferenceView => ({
	kind: "known",
	amount,
	reason: "frozen_rate",
	roundingCaveat: true,
});

describe("groupChangedWork", () => {
	it("groups by customer, then draft, oldest change first at every level", () => {
		const groups = groupChangedWork([
			item("a2", "d-acme-apr", acmeApril, "2026-05-03T08:00:00.000Z", known("1.00")),
			item("b1", "d-beta-mar", betaMarch, "2026-04-02T08:00:00.000Z", known("1.00")),
			item("a1-late", "d-acme-mar", acmeMarch, "2026-04-20T08:00:00.000Z", known("1.00")),
			item("a1-early", "d-acme-mar", acmeMarch, "2026-04-10T08:00:00.000Z", known("1.00")),
		]);

		expect(
			groups.map((customer) => ({
				customer: customer.customerName,
				drafts: customer.drafts.map((draft) => ({
					draft: draft.draftId,
					items: draft.items.map((entry) => entry.invoicedWorkId),
				})),
			})),
		).toEqual([
			{ customer: "Beta", drafts: [{ draft: "d-beta-mar", items: ["b1"] }] },
			{
				customer: "Acme",
				drafts: [
					{ draft: "d-acme-mar", items: ["a1-early", "a1-late"] },
					{ draft: "d-acme-apr", items: ["a2"] },
				],
			},
		]);
	});

	it("subtotals known differences in the draft's currency and counts unknown ones apart", () => {
		const [customer] = groupChangedWork([
			item("1", "d", acmeMarch, "2026-04-02T08:00:00.000Z", known("25.00")),
			item("2", "d", acmeMarch, "2026-04-03T08:00:00.000Z", known("-150.00")),
			item("3", "d", acmeMarch, "2026-04-04T08:00:00.000Z", {
				kind: "unknown",
				reason: "several_rates",
			}),
			item("4", "d", acmeMarch, "2026-04-05T08:00:00.000Z", {
				kind: "unknown",
				reason: "other_project",
			}),
		]);

		expect(customer.drafts[0]).toMatchObject({
			currency: "EUR",
			subtotal: "-125.00",
			subtotalEstimated: false,
			knownCount: 2,
			unknownCount: 2,
		});
	});

	it("has no subtotal when every difference is unknown, never zero", () => {
		const [customer] = groupChangedWork([
			item("1", "d", acmeMarch, "2026-04-02T08:00:00.000Z", {
				kind: "unknown",
				reason: "several_rates",
			}),
		]);

		expect(customer.drafts[0]).toMatchObject({ subtotal: null, knownCount: 0, unknownCount: 1 });
	});

	it("adds the difference since the last resolution, so handled corrections count once", () => {
		const [customer] = groupChangedWork([
			item("1", "d", acmeMarch, "2026-04-02T08:00:00.000Z", known("50.00"), known("25.00")),
			item(
				"2",
				"d",
				acmeMarch,
				"2026-04-03T08:00:00.000Z",
				{ kind: "estimated", amount: "-128.25", reason: "removed", roundingCaveat: false },
				null,
			),
		]);

		expect(customer.drafts[0]).toMatchObject({
			subtotal: "-103.25",
			subtotalEstimated: true,
			knownCount: 2,
			unknownCount: 0,
		});
	});
});
