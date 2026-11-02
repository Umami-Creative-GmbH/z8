import { describe, expect, it } from "vitest";
import { reconciliationCsv } from "./reconciliation-csv";
import { itemMarkVersion } from "./resolution";
import type {
	ComparedWorkValuesView,
	ItemAmountDifferenceView,
	MarkedWorkDraftView,
	MarkedWorkItemView,
	ResolutionHistoryEntryView,
} from "./views";

/** Splits RFC 4180 CSV (BOM, CRLF) into records of raw cell text, quotes removed. */
function parseCsv(content: string): string[][] {
	expect(content.startsWith("﻿")).toBe(true);
	expect(content.endsWith("\r\n")).toBe(true);
	const records: string[][] = [];
	let record: string[] = [];
	let cell = "";
	let quoted = false;
	const text = content.slice(1);
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (char === '"' && text[index + 1] === '"') {
				cell += '"';
				index++;
			} else if (char === '"') quoted = false;
			else cell += char;
		} else if (char === '"') quoted = true;
		else if (char === ",") {
			record.push(cell);
			cell = "";
		} else if (char === "\r" && text[index + 1] === "\n") {
			record.push(cell);
			records.push(record);
			record = [];
			cell = "";
			index++;
		} else cell += char;
	}
	return records;
}

/** The rows as column → cell maps. */
function rowsOf(content: string): Record<string, string>[] {
	const [header, ...rows] = parseCsv(content);
	return rows.map((row) => {
		expect(row).toHaveLength(header.length);
		return Object.fromEntries(header.map((column, index) => [column, row[index]]));
	});
}

/** The raw (still quoted) cells of the first data row, to see how a value was written. */
function rawCells(content: string): Record<string, string> {
	const [headerLine, rowLine] = content.slice(1).split("\r\n");
	const header = parseCsv(`﻿${headerLine}\r\n`)[0];
	const cells: string[] = [];
	let cell = "";
	let quoted = false;
	for (const char of rowLine) {
		if (char === '"') quoted = !quoted;
		if (char === "," && !quoted) {
			cells.push(cell);
			cell = "";
		} else cell += char;
	}
	cells.push(cell);
	return Object.fromEntries(header.map((column, index) => [column, cells[index]]));
}

const handOff: ComparedWorkValuesView = {
	removed: false,
	pieceCount: 1,
	removedPieceCount: 0,
	day: "2026-03-02",
	// 09:00–11:00 at UTC+01:00.
	start: { at: "2026-03-02T08:00:00.000Z", offsetMinutes: 60 },
	end: { at: "2026-03-02T10:00:00.000Z", offsetMinutes: 60 },
	durationMinutes: 120,
	hours: "2.00",
	projects: [{ id: "p-web", name: "Website" }],
	customers: [{ id: "c-acme", name: "Acme" }],
	billability: "billable",
};

const draft: MarkedWorkDraftView = {
	customerId: "c-acme",
	customerName: "Acme",
	currency: "EUR",
	period: { from: "2026-03-01", to: "2026-03-31" },
	title: "Acme March",
	externalId: "RE-1001",
	createdAt: "2026-04-01T09:00:00.000Z",
};

function item(overrides: {
	id?: string;
	current?: Partial<ComparedWorkValuesView>;
	lastResolved?: (Partial<ComparedWorkValuesView> & { resolvedAt: string }) | null;
	amountDifference?: Partial<ItemAmountDifferenceView>;
	history?: ResolutionHistoryEntryView[];
	changedFields?: MarkedWorkItemView["changedFields"];
	open?: boolean;
	openWhenReleased?: boolean;
	draft?: Partial<MarkedWorkDraftView>;
	employeeName?: string;
}): MarkedWorkItemView {
	const id = overrides.id ?? "iw-1";
	return {
		invoicedWorkId: id,
		workPeriodId: `wp-${id}`,
		day: "2026-03-02",
		employeeName: overrides.employeeName ?? "Grace Hopper",
		projectName: "Website",
		hours: "2.00",
		carried: false,
		changedAfterInvoicingAt: overrides.open === false ? null : "2026-04-02T12:00:00.000Z",
		changedFields: overrides.changedFields ?? ["times"],
		invoiceDraftId: "draft-1",
		draft: { ...draft, ...overrides.draft },
		markVersion: itemMarkVersion([{ id, markVersion: 1 }]),
		openWhenReleased: overrides.openWhenReleased ?? false,
		history: overrides.history ?? [],
		comparison: {
			amountDifference: {
				currency: "EUR",
				fromHandOff: { kind: "known", amount: "0.00", reason: "frozen_rate", roundingCaveat: true },
				sinceResolution: null,
				notOnHandOffForNewCustomer: false,
				...overrides.amountDifference,
			},
			handOff,
			lastResolved: overrides.lastResolved
				? { ...handOff, changedFromHandOff: [], ...overrides.lastResolved }
				: null,
			current: {
				...handOff,
				changedFromHandOff: [],
				changedSinceResolution: overrides.lastResolved ? [] : null,
				...overrides.current,
			},
		},
	};
}

describe("reconciliationCsv", () => {
	it("writes a times correction with every value at the offset the work recorded", () => {
		const [row] = rowsOf(
			reconciliationCsv([
				item({
					current: {
						// Ends at 12:00 at UTC+02:00: the clock-out was recorded elsewhere.
						end: { at: "2026-03-02T10:00:00.000Z", offsetMinutes: 120 },
						durationMinutes: 180,
						hours: "3.00",
					},
					amountDifference: {
						fromHandOff: {
							kind: "known",
							amount: "85.50",
							reason: "frozen_rate",
							roundingCaveat: true,
						},
					},
				}),
			]),
		);
		expect(row).toMatchObject({
			invoice_draft_id: "draft-1",
			draft_title: "Acme March",
			draft_accounting_reference: "RE-1001",
			customer: "Acme",
			invoiced_work_id: "iw-1",
			employee: "Grace Hopper",
			day: "2026-03-02",
			mark_status: "open",
			changed_fields: "times",
			hand_off_start: "2026-03-02T09:00:00+01:00",
			hand_off_end: "2026-03-02T11:00:00+01:00",
			hand_off_hours: "2.00",
			hand_off_project: "Website",
			hand_off_customer: "Acme",
			hand_off_billability: "billable",
			hand_off_removed: "false",
			last_resolved_at: "",
			last_resolved_start: "",
			last_resolved_hours: "",
			current_start: "2026-03-02T09:00:00+01:00",
			current_end: "2026-03-02T12:00:00+02:00",
			current_hours: "3.00",
			amount_difference_kind: "known",
			amount_difference_reason: "frozen_rate",
			amount_difference: "85.50",
			amount_difference_since_resolution_kind: "",
			amount_difference_since_resolution: "",
			currency: "EUR",
			new_customer_warning: "false",
			resolution_count: "0",
		});
	});

	it("writes an item resolved twice: its last resolved values and both resolutions, oldest first", () => {
		const content = reconciliationCsv([
			item({
				open: false,
				changedFields: [],
				lastResolved: {
					resolvedAt: "2026-04-05T14:30:00.000Z",
					end: { at: "2026-03-02T11:00:00.000Z", offsetMinutes: 60 },
					durationMinutes: 180,
					hours: "3.00",
				},
				current: {
					end: { at: "2026-03-02T11:00:00.000Z", offsetMinutes: 60 },
					durationMinutes: 180,
					hours: "3.00",
				},
				amountDifference: {
					fromHandOff: {
						kind: "known",
						amount: "85.50",
						reason: "frozen_rate",
						roundingCaveat: true,
					},
					sinceResolution: {
						kind: "known",
						amount: "0.00",
						reason: "frozen_rate",
						roundingCaveat: false,
					},
				},
				history: [
					{
						kind: "resolution",
						id: "r-2",
						invoicedWorkId: "iw-1",
						at: "2026-04-05T14:30:00.000Z",
						actorName: "Ada Admin",
						explanation: "Credit note sent",
						accountingReference: "GS-7",
						resolvedFields: ["times"],
					},
					{
						kind: "resolution",
						id: "r-1",
						invoicedWorkId: "iw-1",
						at: "2026-04-03T08:00:00.000Z",
						actorName: null,
						explanation: "Checked with the customer",
						accountingReference: null,
						resolvedFields: ["times"],
					},
				],
			}),
		]);
		const [row] = rowsOf(content);
		expect(row).toMatchObject({
			mark_status: "resolved",
			changed_fields: "",
			last_resolved_at: "2026-04-05T14:30:00Z",
			last_resolved_start: "2026-03-02T09:00:00+01:00",
			last_resolved_end: "2026-03-02T12:00:00+01:00",
			last_resolved_hours: "3.00",
			last_resolved_removed: "false",
			amount_difference: "85.50",
			amount_difference_since_resolution_kind: "known",
			amount_difference_since_resolution_reason: "frozen_rate",
			amount_difference_since_resolution: "0.00",
			resolution_count: "2",
			resolution_1_kind: "resolution",
			resolution_1_at: "2026-04-03T08:00:00Z",
			resolution_1_actor: "",
			resolution_1_explanation: "Checked with the customer",
			resolution_1_accounting_reference: "",
			resolution_2_kind: "resolution",
			resolution_2_at: "2026-04-05T14:30:00Z",
			resolution_2_actor: "Ada Admin",
			resolution_2_explanation: "Credit note sent",
			resolution_2_accounting_reference: "GS-7",
		});
	});

	it("writes a mark still open on a released draft as open when released", () => {
		const rows = rowsOf(
			reconciliationCsv([
				item({ id: "iw-1", openWhenReleased: true }),
				item({ id: "iw-2", open: false, changedFields: [] }),
				item({ id: "iw-3" }),
			]),
		);
		expect(rows.map((row) => [row.invoiced_work_id, row.mark_status, row.changed_fields])).toEqual([
			["iw-1", "open_when_released", "times"],
			["iw-2", "resolved", ""],
			["iw-3", "open", "times"],
		]);
	});

	it("gives every row as many resolution columns as the item with the most, and writes earlier clears", () => {
		const rows = rowsOf(
			reconciliationCsv([
				item({ id: "iw-1" }),
				item({
					id: "iw-2",
					history: [
						{
							kind: "cleared_before_resolutions",
							invoicedWorkId: "iw-2",
							at: "2026-03-20T10:00:00.000Z",
							actorName: "Ada Admin",
						},
					],
				}),
			]),
		);
		expect(rows[0]).toMatchObject({ resolution_count: "0", resolution_1_kind: "" });
		expect(rows[1]).toMatchObject({
			resolution_count: "1",
			resolution_1_kind: "cleared_before_resolutions",
			resolution_1_at: "2026-03-20T10:00:00Z",
			resolution_1_actor: "Ada Admin",
			resolution_1_explanation: "",
		});
	});

	it("writes a several-rates difference as unknown with its reason, never as 0", () => {
		const content = reconciliationCsv([
			item({
				current: { durationMinutes: 180, hours: "3.00" },
				amountDifference: {
					fromHandOff: { kind: "unknown", reason: "several_rates" },
					sinceResolution: { kind: "unknown", reason: "several_rates" },
				},
			}),
		]);
		expect(rowsOf(content)[0]).toMatchObject({
			amount_difference_kind: "unknown",
			amount_difference_reason: "several_rates",
			amount_difference: "",
			amount_difference_since_resolution_kind: "unknown",
			amount_difference_since_resolution_reason: "several_rates",
			amount_difference_since_resolution: "",
			currency: "EUR",
		});
		// An empty cell, not an empty string a spreadsheet could sum as 0.
		expect(rawCells(content)).toMatchObject({ amount_difference: "" });
	});

	it("writes a removal as a full reversal, without current values", () => {
		const [row] = rowsOf(
			reconciliationCsv([
				item({
					changedFields: ["removed"],
					current: {
						removed: true,
						removedPieceCount: 1,
						day: null,
						start: null,
						end: null,
						durationMinutes: 0,
						hours: "0.00",
						projects: [],
						customers: [],
						billability: null,
					},
					amountDifference: {
						fromHandOff: {
							kind: "known",
							amount: "-200.00",
							reason: "removed",
							roundingCaveat: false,
						},
					},
				}),
			]),
		);
		expect(row).toMatchObject({
			changed_fields: "removed",
			hand_off_hours: "2.00",
			hand_off_removed: "false",
			current_start: "",
			current_end: "",
			current_hours: "",
			current_project: "",
			current_billability: "",
			current_removed: "true",
			amount_difference_kind: "known",
			amount_difference_reason: "removed",
			amount_difference: "-200.00",
		});
	});

	it("writes a project moved to another customer as a reversal with the new-customer warning", () => {
		const [row] = rowsOf(
			reconciliationCsv([
				item({
					changedFields: ["customer"],
					current: { customers: [{ id: "c-beta", name: "Beta" }] },
					amountDifference: {
						fromHandOff: {
							kind: "estimated",
							amount: "-200.00",
							reason: "customer",
							roundingCaveat: false,
						},
						notOnHandOffForNewCustomer: true,
					},
				}),
			]),
		);
		expect(row).toMatchObject({
			hand_off_customer: "Acme",
			current_customer: "Beta",
			amount_difference_kind: "estimated",
			amount_difference_reason: "customer",
			amount_difference: "-200.00",
			new_customer_warning: "true",
		});
	});

	it("writes split pieces partly removed, several projects, and work still running", () => {
		const [row] = rowsOf(
			reconciliationCsv([
				item({
					current: {
						pieceCount: 3,
						removedPieceCount: 1,
						end: null,
						projects: [
							{ id: "p-web", name: "Website" },
							{ id: "p-gone", name: null },
							{ id: null, name: null },
						],
						billability: "mixed",
					},
					amountDifference: { fromHandOff: { kind: "unknown", reason: "running" } },
				}),
			]),
		);
		expect(row).toMatchObject({
			current_end: "",
			current_project: "Website; p-gone; ",
			current_billability: "mixed",
			current_removed: "partial",
			amount_difference_kind: "unknown",
			amount_difference_reason: "running",
		});
	});

	it("writes only the header when nothing is marked", () => {
		const [header, ...rows] = parseCsv(reconciliationCsv([]));
		expect(rows).toEqual([]);
		expect(header[0]).toBe("invoice_draft_id");
		expect(header.at(-1)).toBe("resolution_count");
	});

	it("neutralises formulas in names, explanations and references", () => {
		const content = reconciliationCsv([
			item({
				employeeName: '=HYPERLINK("x")',
				draft: { title: "+Acme", customerName: "@Acme", externalId: "-1" },
				history: [
					{
						kind: "resolution",
						id: "r-1",
						invoicedWorkId: "iw-1",
						at: "2026-04-03T08:00:00.000Z",
						actorName: "=Ada",
						explanation: "  =1+2",
						accountingReference: "@SUM(A1)",
						resolvedFields: ["times"],
					},
				],
			}),
		]);
		expect(rawCells(content)).toMatchObject({
			employee: `"'=HYPERLINK(""x"")"`,
			draft_title: `"'+Acme"`,
			customer: `"'@Acme"`,
			draft_accounting_reference: `"'-1"`,
			resolution_1_actor: `"'=Ada"`,
			resolution_1_explanation: `"'  =1+2"`,
			resolution_1_accounting_reference: `"'@SUM(A1)"`,
			// Amounts and hours stay numbers.
			hand_off_hours: "2.00",
			amount_difference: "0.00",
		});
	});
});
