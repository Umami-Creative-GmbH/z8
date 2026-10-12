import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { absenceNotEndedAt, isDeputyMissing } from "./deputy-missing";

describe("absenceNotEndedAt", () => {
	const at = parseInstant("2026-10-01T22:30:00Z");

	it("keeps an absence ending today in the absent employee's zone running", () => {
		// 2026-10-02 00:30 in Berlin.
		expect(absenceNotEndedAt("2026-10-02", at, "Europe/Berlin")).toBe(true);
	});

	it("treats an absence that ended yesterday in the absent employee's zone as ended", () => {
		expect(absenceNotEndedAt("2026-10-01", at, "Europe/Berlin")).toBe(false);
	});

	it("evaluates the day in the absent employee's zone, not UTC", () => {
		// Still 2026-10-01 in New York.
		expect(absenceNotEndedAt("2026-10-01", at, "America/New_York")).toBe(true);
	});
});

describe("isDeputyMissing", () => {
	const required = {
		deputyRequired: true,
		deputyEmployeeId: null,
		status: "approved" as const,
		endDate: "2026-10-05",
	};

	it("flags a running or upcoming absence whose category requires a deputy and has none", () => {
		expect(isDeputyMissing(required, "2026-10-05")).toBe(true);
		expect(isDeputyMissing({ ...required, status: "pending" }, "2026-09-01")).toBe(true);
	});

	it("does not flag an absence that names a deputy", () => {
		expect(isDeputyMissing({ ...required, deputyEmployeeId: "ben" }, "2026-10-01")).toBe(false);
	});

	it("does not flag a category that does not require a deputy", () => {
		expect(isDeputyMissing({ ...required, deputyRequired: false }, "2026-10-01")).toBe(false);
	});

	it("does not flag an ended or rejected absence", () => {
		expect(isDeputyMissing(required, "2026-10-06")).toBe(false);
		expect(isDeputyMissing({ ...required, status: "rejected" }, "2026-10-01")).toBe(false);
	});
});
