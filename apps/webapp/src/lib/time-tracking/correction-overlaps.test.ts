import { describe, expect, it } from "vitest";
import {
	type CorrectionOverlap,
	fitCorrectionRange,
} from "./correction-overlaps";

const range = {
	startAt: "2026-11-02T13:17:00Z",
	endAt: "2026-11-02T15:10:00Z",
};
const occupied = (
	startAt: string,
	endAt: string | null,
): CorrectionOverlap => ({ kind: "work_period", id: startAt, startAt, endAt });
describe("fitting a requested correction", () => {
	it("cuts an overlapping start without changing existing work", () => {
		const overlaps = [occupied("2026-11-02T12:00:00Z", "2026-11-02T13:30:00Z")];
		expect(fitCorrectionRange(range, overlaps)).toEqual({
			startAt: "2026-11-02T13:30:00Z",
			endAt: range.endAt,
		});
		expect(overlaps[0].endAt).toBe("2026-11-02T13:30:00Z");
	});
	it("cuts both ends and accepts adjacent work", () => {
		expect(
			fitCorrectionRange(range, [
				occupied("2026-11-02T12:00:00Z", "2026-11-02T13:30:00Z"),
				occupied("2026-11-02T15:00:00Z", null),
			]),
		).toEqual({
			startAt: "2026-11-02T13:30:00Z",
			endAt: "2026-11-02T15:00:00Z",
		});
		expect(
			fitCorrectionRange(range, [
				occupied("2026-11-02T12:00:00Z", range.startAt),
				occupied(range.endAt, null),
			]),
		).toEqual(range);
	});
	it("never joins disjoint gaps and picks the longest gap deterministically", () => {
		const overlaps = [
			occupied("2026-11-02T14:00:00Z", "2026-11-02T14:20:00Z"),
			occupied("2026-11-02T13:20:00Z", "2026-11-02T13:30:00Z"),
		];
		expect(fitCorrectionRange(range, overlaps)).toEqual({
			startAt: "2026-11-02T14:20:00Z",
			endAt: range.endAt,
		});
		expect(fitCorrectionRange(range, overlaps.toReversed())).toEqual(
			fitCorrectionRange(range, overlaps),
		);
	});
	it("returns no suggestion for fully occupied or invalid ranges", () => {
		expect(
			fitCorrectionRange(range, [occupied("2026-11-02T12:00:00Z", null)]),
		).toBeNull();
		expect(
			fitCorrectionRange({ startAt: range.endAt, endAt: range.startAt }, []),
		).toBeNull();
	});
	it("uses UTC instants across a daylight saving transition", () => {
		expect(
			fitCorrectionRange(
				{ startAt: "2026-10-25T00:00:00Z", endAt: "2026-10-25T03:00:00Z" },
				[occupied("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z")],
			),
		).toEqual({
			startAt: "2026-10-25T01:30:00Z",
			endAt: "2026-10-25T03:00:00Z",
		});
	});
});
