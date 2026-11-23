import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { statutoryInputFingerprint } from "./fingerprint";

describe("statutoryInputFingerprint", () => {
	it("hashes the canonical JSON of the evaluated inputs (sorted keys, array order kept)", () => {
		// sha256('{"a":"x","b":[2,1],"c":{"d":null,"e":true}}'), computed outside this codebase.
		expect(statutoryInputFingerprint({ c: { e: true, d: null }, b: [2, 1], a: "x" })).toBe(
			"v1:50e384560f296ff0d42f7f7f75eccb2725efacf8dcc538f3a7121e16e541bf0b",
		);
	});

	it("does not depend on key order but does on every value", () => {
		const base = statutoryInputFingerprint({ month: "2026-03", minutes: [240, 300] });

		expect(statutoryInputFingerprint({ minutes: [240, 300], month: "2026-03" })).toBe(base);
		expect(statutoryInputFingerprint({ month: "2026-03", minutes: [240, 300, 60] })).not.toBe(base);
		expect(statutoryInputFingerprint({ month: "2026-03", minutes: [300, 240] })).not.toBe(base);
	});

	it("writes instants and dates in their canonical string form", () => {
		expect(statutoryInputFingerprint({ at: Temporal.Instant.from("2026-03-01T08:00:00Z") })).toBe(
			statutoryInputFingerprint({ at: "2026-03-01T08:00:00Z" }),
		);
		expect(statutoryInputFingerprint({ on: Temporal.PlainDate.from("2026-03-01") })).toBe(
			statutoryInputFingerprint({ on: "2026-03-01" }),
		);
	});

	it("refuses values that have no stable JSON form", () => {
		expect(() => statutoryInputFingerprint({ value: undefined })).toThrow(TypeError);
		expect(() => statutoryInputFingerprint({ value: Number.NaN })).toThrow(TypeError);
		expect(() => statutoryInputFingerprint({ at: new Date("2026-03-01T08:00:00Z") })).toThrow(
			TypeError,
		);
	});
});
