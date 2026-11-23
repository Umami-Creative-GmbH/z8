import { describe, expect, it } from "vitest";
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";
import deCatalog from "../../../messages/scheduling/de.json";
import enCatalog from "../../../messages/scheduling/en.json";
import { youthProtectionWarningText } from "./youth-protection-warning-text";

function catalogText(catalog: unknown, key: string): unknown {
	return key
		.replace(/^scheduling:/, "")
		.split(".")
		.reduce<unknown>(
			(node, part) =>
				node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined,
			catalog,
		);
}

const base: StatutoryComplianceFinding = {
	type: "statutory",
	employeeId: "e1",
	findingId: "f1",
	statutoryKind: "jarbschg_shift_span",
	domain: "youth_protection",
	severity: "critical",
	subjectKey: "shift:s1",
	legalReference: "§ 12 JArbSchG",
	summary: {
		tier: "exceeded",
		used: { unit: "minutes", value: 720 },
		limit: { unit: "minutes", value: 600 },
	},
	day: "2027-03-02",
	acknowledgementStatus: null,
	blocksPublication: true,
};

/** The key asked for, the values it was given, and the English default. */
function textOf(finding: StatutoryComplianceFinding) {
	const calls: { key: string; fallback: string; params?: Record<string, unknown> }[] = [];
	const t = ((key: string, fallback: string, params?: Record<string, unknown>) => {
		calls.push({ key, fallback, params });
		return fallback;
	}) as Parameters<typeof youthProtectionWarningText>[1];
	const text = youthProtectionWarningText(finding, t, "en-US");
	return { text, call: calls[0] };
}

describe("youthProtectionWarningText (#1993)", () => {
	it("names the day, span and limit of a § 12 shift span, in English and German", () => {
		const { text, call } = textOf(base);
		expect(text).not.toBeNull();
		expect(call?.params).toEqual({ used: 720, limit: 600, date: "Mar 2, 2027" });
		expect(catalogText(enCatalog, call?.key ?? "")).toBe(call?.fallback);
		expect(catalogText(deCatalog, call?.key ?? "")).not.toBe(call?.fallback);
		expect(typeof catalogText(deCatalog, call?.key ?? "")).toBe("string");
	});

	it("words work past a block week's training allowance by the week's minutes", () => {
		const { call } = textOf({
			...base,
			statutoryKind: "bbig_release_day_shift",
			domain: "apprenticeship",
			legalReference: "§ 9 Abs. 1 Nr. 3 JArbSchG",
			summary: {
				tier: "exceeded",
				used: { unit: "minutes", value: 150 },
				limit: { unit: "minutes", value: 120 },
			},
			day: undefined,
			releaseDay: "2027-03-03",
		});
		expect(call?.params).toEqual({ used: 150, limit: 120, date: "Mar 3, 2027" });
		expect(catalogText(enCatalog, call?.key ?? "")).toBe(call?.fallback);
		expect(typeof catalogText(deCatalog, call?.key ?? "")).toBe("string");
		expect(catalogText(deCatalog, call?.key ?? "")).not.toBe(call?.fallback);
	});

	it("keeps the release-day wording for other release conflicts", () => {
		const { call } = textOf({
			...base,
			statutoryKind: "bbig_release_day_shift",
			domain: "apprenticeship",
			summary: { tier: "exceeded" },
			day: undefined,
			releaseDay: "2027-03-03",
		});
		expect(call?.key).toBe("scheduling:scheduling.statutory.apprenticeship.releaseDayShiftOn");
	});
});
