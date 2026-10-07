import { describe, expect, it } from "vitest";
import { reportKindLabel, reportName } from "./report-name";

const t = (_key: string, fallback: string) => fallback;

describe("reportName", () => {
	it("names a report by its trip purpose, description or route", () => {
		expect(reportName(t, { kind: "trip", itemType: null, title: "Customer workshop" })).toBe(
			"Customer workshop",
		);
		expect(
			reportName(t, { kind: "standalone", itemType: "mileage", title: "Home – Hamburg" }),
		).toBe("Home – Hamburg");
	});

	it("falls back to an untitled name per kind", () => {
		expect(reportName(t, { kind: "trip", itemType: null, title: null })).toBe("Untitled trip");
		expect(reportName(t, { kind: "standalone", itemType: "receipt", title: "" })).toBe(
			"Untitled receipt",
		);
		expect(reportName(t, { kind: "standalone", itemType: "mileage", title: "   " })).toBe(
			"Untitled mileage",
		);
	});
});

describe("reportKindLabel", () => {
	it("labels trips and standalone receipts and mileage", () => {
		expect(reportKindLabel(t, { kind: "trip", itemType: null })).toBe("Trip report");
		expect(reportKindLabel(t, { kind: "standalone", itemType: "receipt" })).toBe(
			"Standalone receipt",
		);
		expect(reportKindLabel(t, { kind: "standalone", itemType: "mileage" })).toBe(
			"Standalone mileage",
		);
	});
});
