import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { parseInstant, parsePlainDate, parsePlainTimeMinute } from "./temporal-core";
import {
	assertPrimitiveDateTimePayload,
	deserializeInstant,
	deserializePlainDate,
	deserializePlainTimeMinute,
	instantWireSchema,
	serializeInstant,
	serializePlainDate,
	serializePlainTimeMinute,
} from "./temporal-wire";

describe("temporal wire formats", () => {
	it.each([
		["2024-01-15T10:30:00Z", "2024-01-15T10:30:00.000Z"],
		["2024-01-15T10:30:00.123Z", "2024-01-15T10:30:00.123Z"],
		["2024-01-15T10:30:00.999Z", "2024-01-15T10:30:00.999Z"],
	])("serializes %s with fixed millisecond precision", (input, expected) => {
		expect(serializeInstant(parseInstant(input))).toBe(expected);
	});

	it("rejects instants with sub-millisecond precision", () => {
		expect(() =>
			serializeInstant(Temporal.Instant.from("2026-07-10T12:30:00.123000001Z")),
		).toThrow();
	});

	it("normalizes offset instants to UTC wire strings", () => {
		expect(serializeInstant(parseInstant("2024-01-15T11:30:00.123+01:00"))).toBe(
			"2024-01-15T10:30:00.123Z",
		);
	});

	it("accepts only fixed UTC instant wire strings", () => {
		expect(instantWireSchema.parse("2024-01-15T10:30:00.000Z")).toBe("2024-01-15T10:30:00.000Z");

		for (const invalid of [
			"2024-01-15T10:30:00Z",
			"2024-01-15T10:30:00.00Z",
			"2024-01-15T10:30:00.000+00:00",
			"2024-02-30T10:30:00.000Z",
			"2016-12-31T23:59:60.000Z",
		]) {
			expect(instantWireSchema.safeParse(invalid).success).toBe(false);
			expect(() => deserializeInstant(invalid)).toThrow();
		}
	});

	it("deserializes fixed instant wire strings explicitly", () => {
		const instant = deserializeInstant("2024-01-15T10:30:00.123Z");

		expect(instant).toBeInstanceOf(Temporal.Instant);
		expect(serializeInstant(instant)).toBe("2024-01-15T10:30:00.123Z");
	});

	it("round-trips strict plain dates through primitive wire strings", () => {
		const wireValue = serializePlainDate(parsePlainDate("2024-02-29"));

		expect(typeof wireValue).toBe("string");
		expect(wireValue).toBe("2024-02-29");
		expect(deserializePlainDate(wireValue)).toBeInstanceOf(Temporal.PlainDate);
		expect(serializePlainDate(deserializePlainDate(wireValue))).toBe(wireValue);
		expect(() => deserializePlainDate("2023-02-29")).toThrow();
		expect(() => deserializePlainDate("2024-02-29T00:00:00")).toThrow();
	});

	it("round-trips exact-minute times through primitive wire strings", () => {
		const wireValue = serializePlainTimeMinute(parsePlainTimeMinute("09:07"));

		expect(typeof wireValue).toBe("string");
		expect(wireValue).toBe("09:07");
		expect(deserializePlainTimeMinute(wireValue)).toBeInstanceOf(Temporal.PlainTime);
		expect(serializePlainTimeMinute(deserializePlainTimeMinute(wireValue))).toBe(wireValue);
		expect(() => deserializePlainTimeMinute("09:07:00")).toThrow();
	});

	it.each([
		["seconds", "09:07:01"],
		["milliseconds", "09:07:00.001"],
		["microseconds", "09:07:00.000001"],
		["nanoseconds", "09:07:00.000000001"],
	])("rejects PlainTime values with non-zero %s", (_precision, value) => {
		expect(() => serializePlainTimeMinute(Temporal.PlainTime.from(value))).toThrow();
	});
});

describe("primitive date-time payload guard", () => {
	it("rejects Date instances", () => {
		expect(() => assertPrimitiveDateTimePayload(new Date())).toThrowError(/\$.*Date/);
		expect(() => assertPrimitiveDateTimePayload({ envelope: [new Date()] })).toThrowError(
			/\$\.envelope\[0\].*Date/,
		);
	});

	it.each([
		["Duration", Temporal.Duration.from("PT1H")],
		["Instant", Temporal.Instant.from("2024-01-15T10:30:00Z")],
		["PlainDate", Temporal.PlainDate.from("2024-01-15")],
		["PlainDateTime", Temporal.PlainDateTime.from("2024-01-15T10:30:00")],
		["PlainMonthDay", Temporal.PlainMonthDay.from("--01-15")],
		["PlainTime", Temporal.PlainTime.from("10:30:00")],
		["PlainYearMonth", Temporal.PlainYearMonth.from("2024-01")],
		["ZonedDateTime", Temporal.ZonedDateTime.from("2024-01-15T11:30:00+01:00[Europe/Berlin]")],
	])("rejects nested Temporal.%s instances", (name, temporalValue) => {
		expect(() => assertPrimitiveDateTimePayload({ envelope: [{ temporalValue }] })).toThrowError(
			new RegExp(`\\$\\.envelope\\[0\\]\\.temporalValue.*Temporal\\.${name}`),
		);
	});

	it("rejects undefined values, including nested values", () => {
		expect(() => assertPrimitiveDateTimePayload(undefined)).toThrowError(/\$.*undefined/);
		expect(() => assertPrimitiveDateTimePayload({ nested: [undefined] })).toThrowError(
			/\$\.nested\[0\].*undefined/,
		);
	});

	it.each([
		["bigint", BigInt(1), "bigint"],
		["symbol", Symbol("value"), "symbol"],
		["function", () => undefined, "function"],
		["NaN", Number.NaN, "NaN"],
		["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
		["negative Infinity", Number.NEGATIVE_INFINITY, "-Infinity"],
	])("rejects nested JSON-unsafe %s values with path and type", (_description, value, type) => {
		expect(() => assertPrimitiveDateTimePayload({ nested: { value } })).toThrowError(
			new RegExp(`\\$\\.nested\\.value.*${type}`),
		);
	});

	it("rejects symbol-keyed own properties with path and type", () => {
		const secret = Symbol("secret");
		const payload = { nested: { [secret]: "hidden" } };

		expect(() => assertPrimitiveDateTimePayload(payload)).toThrowError(
			/\$\.nested\[Symbol\(secret\)\].*symbol-keyed property/,
		);
	});

	it("rejects an array's own toJSON hook without invoking it", () => {
		let invocations = 0;
		const payload = ["safe"];
		Object.defineProperty(payload, "toJSON", {
			value: () => {
				invocations += 1;
				return {
					date: new Date("2024-01-15T10:30:00.000Z"),
					instant: Temporal.Instant.from("2024-01-15T10:30:00Z"),
				};
			},
		});

		expect(() => assertPrimitiveDateTimePayload(payload)).toThrowError(
			/\$\.toJSON.*toJSON serialization hook/,
		);
		expect(invocations).toBe(0);
	});

	it("rejects a plain object's own toJSON hook without invoking it", () => {
		let invocations = 0;
		const payload = { value: "safe" };
		Object.defineProperty(payload, "toJSON", {
			value: () => {
				invocations += 1;
				return new Date("2024-01-15T10:30:00.000Z");
			},
		});

		expect(() => assertPrimitiveDateTimePayload(payload)).toThrowError(
			/\$\.toJSON.*toJSON serialization hook/,
		);
		expect(invocations).toBe(0);
	});

	it("accepts ordinary plain objects and arrays without converting them", () => {
		const payload = {
			active: true,
			attempts: 2,
			date: "2024-02-29",
			instant: "2024-02-29T10:30:00.000Z",
			metadata: null,
			times: ["09:00", "17:00"],
		};

		expect(assertPrimitiveDateTimePayload(payload)).toBeUndefined();
		expect(payload.instant).toBe("2024-02-29T10:30:00.000Z");
	});

	it("rejects cycles with their path", () => {
		const payload: Record<string, unknown> = { date: "2024-02-29" };
		payload.self = payload;

		expect(() => assertPrimitiveDateTimePayload(payload)).toThrowError(/\$\.self.*cycle/);
	});

	it("accepts repeated acyclic references", () => {
		const shared = { date: "2024-02-29" };

		expect(() => assertPrimitiveDateTimePayload({ left: shared, right: shared })).not.toThrow();
	});
});
