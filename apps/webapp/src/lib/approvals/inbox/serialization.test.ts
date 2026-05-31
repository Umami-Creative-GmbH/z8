import { describe, expect, it } from "vitest";
import {
	assertSerializableApprovalPayload,
	getAgeDays,
	serializeDate,
} from "@/lib/approvals/inbox/serialization";

describe("approval inbox serialization", () => {
	it("serializes dates as ISO strings", () => {
		expect(serializeDate(new Date("2026-05-31T09:00:00.000Z"))).toBe(
			"2026-05-31T09:00:00.000Z",
		);
	});

	it("serializes null dates as null", () => {
		expect(serializeDate(null)).toBeNull();
	});

	it("serializes undefined dates as null", () => {
		expect(serializeDate(undefined)).toBeNull();
	});

	it("normalizes ISO strings with offsets to UTC ISO strings", () => {
		expect(serializeDate("2026-05-31T11:00:00.000+02:00")).toBe(
			"2026-05-31T09:00:00.000Z",
		);
	});

	it("throws for invalid ISO strings", () => {
		expect(() => serializeDate("not-a-date")).toThrow(/Invalid approval inbox date/);
	});

	it("throws for empty date strings", () => {
		expect(() => serializeDate("")).toThrow(/Invalid approval inbox date/);
	});

	it("throws for invalid Date instances", () => {
		expect(() => serializeDate(new Date("not-a-date"))).toThrow(/Invalid approval inbox date/);
	});

	it("calculates whole UTC age days without native date math in callers", () => {
		expect(
			getAgeDays({
				createdAt: new Date("2026-05-28T09:00:00.000Z"),
				now: new Date("2026-05-31T10:00:00.000Z"),
			}),
		).toBe(3);
	});

	it("accepts JSON-safe approval payloads", () => {
		expect(() => assertSerializableApprovalPayload({ ok: "yes" })).not.toThrow();
	});

	it("rejects undefined object fields", () => {
		expect(() => assertSerializableApprovalPayload({ bad: undefined })).toThrow(
			/undefined value/,
		);
	});

	it("rejects undefined array items", () => {
		expect(() => assertSerializableApprovalPayload([undefined])).toThrow(/undefined value/);
	});

	it("rejects function object fields", () => {
		expect(() => assertSerializableApprovalPayload({ bad: () => null })).toThrow(/function/);
	});

	it("rejects Date instances", () => {
		expect(() =>
			assertSerializableApprovalPayload({ bad: new Date("2026-05-31T09:00:00.000Z") }),
		).toThrow(/Date/);
	});
});
