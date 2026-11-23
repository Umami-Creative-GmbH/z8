import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StatementTranslate } from "../labels";
import type { ContractorStatement } from "../statement";

type Tree = { [key: string]: string | Tree };

function lookup(tree: Tree, key: string): string | undefined {
	let node: string | Tree | undefined = tree;
	for (const part of key.split(".")) {
		if (typeof node !== "object" || node === null) return undefined;
		node = node[part];
	}
	return typeof node === "string" ? node : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
	return text.replace(/\{(\w+)\}/g, (match, name: string) =>
		params && name in params ? String(params[name]) : match,
	);
}

/** Tolgee's `t` over the app's real `common` catalog of `locale`, as the server loads it. */
export function catalogT(locale: "en" | "de"): StatementTranslate {
	const tree = JSON.parse(
		readFileSync(join(process.cwd(), "messages", "common", `${locale}.json`), "utf8"),
	) as Tree;
	return (key, defaultValue, params) => {
		const translated = lookup(tree, key.replace(/^common:/, ""));
		if (locale !== "en" && translated === undefined) {
			throw new Error(`Missing ${locale} translation: ${key}`);
		}
		return interpolate(translated ?? defaultValue, params);
	};
}

/** A statement as the builder returns it: two priced days, one unpriced day. */
export function sampleStatement(overrides: Partial<ContractorStatement> = {}): ContractorStatement {
	return {
		organizationName: "Acme GmbH",
		contractor: {
			id: "contractor-1",
			name: "Jo Freelance",
			employeeNumber: "C-7",
			companyName: "Jo Consulting UG",
			vatId: "DE123456789",
			referenceCode: "=PO-4711",
		},
		period: { fromDay: "2026-03-01", toDay: "2026-03-31" },
		generatedAt: "2026-04-01T08:00:00Z",
		days: [
			{
				date: "2026-03-02",
				workedMinutes: 270,
				pricing: {
					basis: "daily",
					dayUnitRule: { kind: "half_and_full_day", halfDayThresholdMinutes: 240 },
					currency: "EUR",
					rate: "600.00",
					unit: "day",
					units: "1.0000",
					amount: "600.00",
				},
				lines: [
					{
						workId: "w1",
						start: "2026-03-02T09:00+01:00",
						end: "2026-03-02T12:00+01:00",
						workedMinutes: 180,
						projectName: "Website, relaunch",
						taskName: "Design",
						awaitingApproval: false,
						amount: "400.00",
					},
					{
						workId: "w2",
						start: "2026-03-02T13:00+01:00",
						end: "2026-03-02T14:30+01:00",
						workedMinutes: 90,
						projectName: "Shop",
						taskName: null,
						awaitingApproval: true,
						amount: "200.00",
					},
				],
			},
			{
				date: "2026-03-03",
				workedMinutes: 120,
				pricing: {
					basis: "daily",
					dayUnitRule: { kind: "half_and_full_day", halfDayThresholdMinutes: 240 },
					currency: "EUR",
					rate: "600.00",
					unit: "day",
					units: "0.5000",
					amount: "300.00",
				},
				lines: [
					{
						workId: "w3",
						start: "2026-03-03T09:00+01:00",
						end: "2026-03-03T11:00+01:00",
						workedMinutes: 120,
						projectName: "Shop",
						taskName: null,
						awaitingApproval: false,
						amount: "300.00",
					},
				],
			},
			{
				date: "2026-03-20",
				workedMinutes: 60,
				pricing: null,
				lines: [
					{
						workId: "w4",
						start: "2026-03-20T09:00+01:00",
						end: "2026-03-20T10:00+01:00",
						workedMinutes: 60,
						projectName: null,
						taskName: null,
						awaitingApproval: false,
						amount: null,
					},
				],
			},
		],
		totals: [
			{ currency: "EUR", amount: "900.00", hours: "0.0000", days: "1.5000", workedMinutes: 390 },
		],
		projects: [
			{ projectName: "Shop", currency: "EUR", workedMinutes: 210, amount: "500.00" },
			{ projectName: "Website, relaunch", currency: "EUR", workedMinutes: 180, amount: "400.00" },
		],
		unpriced: { workedMinutes: 60, days: 1 },
		awaitingApprovalLines: 1,
		...overrides,
	};
}
