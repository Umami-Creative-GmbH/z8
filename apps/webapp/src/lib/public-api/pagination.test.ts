import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageOf } from "./pagination";

describe("Public API cursors", () => {
	it("round-trips a sort key", () => {
		const cursor = encodeCursor(["2026-10-01T08:00:00.000Z", "a1"]);
		expect(decodeCursor(cursor, ["string", "string"])).toEqual(["2026-10-01T08:00:00.000Z", "a1"]);
	});

	it("rejects cursors of another shape or garbage", () => {
		expect(decodeCursor(encodeCursor(["a"]), ["string", "string"])).toBeNull();
		expect(decodeCursor(encodeCursor([1, "a"]), ["string", "string"])).toBeNull();
		expect(decodeCursor("not-a-cursor", ["string"])).toBeNull();
		expect(decodeCursor(Buffer.from("{}").toString("base64url"), ["string"])).toBeNull();
	});

	it("checks every part of the sort key", () => {
		const id = "4f8c2a1e-9b7d-4c3a-8e2f-1a2b3c4d5e6f";
		expect(decodeCursor(encodeCursor([id]), ["uuid"])).toEqual([id]);
		expect(decodeCursor(encodeCursor(["x'); drop table"]), ["uuid"])).toBeNull();
		expect(decodeCursor(encodeCursor(["2026-10-01"]), ["date"])).toEqual(["2026-10-01"]);
		expect(decodeCursor(encodeCursor(["yesterday"]), ["instant"])).toBeNull();
	});

	it("pages limit rows and points past the last one only when more follow", () => {
		const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
		const first = pageOf(
			rows,
			2,
			(row) => row.id,
			(row) => [row.id],
		);
		expect(first.data).toEqual(["a", "b"]);
		expect(first.nextCursor && decodeCursor(first.nextCursor, ["string"])).toEqual(["b"]);
		expect(
			pageOf(
				rows.slice(2),
				2,
				(row) => row.id,
				(row) => [row.id],
			),
		).toEqual({
			data: ["c"],
			nextCursor: null,
		});
	});
});
