import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { interpretImportedWorkInterval, NO_PROVIDER_EVIDENCE } from "./imported-work-interval";

const now = parseInstant("2026-07-22T12:00:00Z");

function interpret(
	startsAt: string,
	endsAt: string | null,
	evidence: Partial<typeof NO_PROVIDER_EVIDENCE> = {},
) {
	return interpretImportedWorkInterval({
		startsAt,
		endsAt,
		evidence: { ...NO_PROVIDER_EVIDENCE, ...evidence },
		now,
	});
}

describe("interpretImportedWorkInterval", () => {
	it("derives fresh minutes from the exact UTC endpoints, half up", () => {
		expect(interpret("2026-07-20T08:00:00Z", "2026-07-20T09:00:40Z")).toMatchObject({
			kind: "completed",
			durationMinutes: 61,
		});
		expect(interpret("2026-07-20T08:00:00Z", "2026-07-20T08:00:29Z")).toMatchObject({
			kind: "completed",
			durationMinutes: 0,
		});
		expect(interpret("2026-07-20T08:00:00Z", "2026-07-20T08:00:30Z")).toMatchObject({
			kind: "completed",
			durationMinutes: 1,
		});
	});

	it("reads explicit offsets as exact instants", () => {
		const result = interpret("2026-07-20T10:00:00+02:00", "2026-07-20T09:30:00Z");
		expect(result).toMatchObject({ kind: "completed", durationMinutes: 90 });
		if (result.kind !== "completed") throw new Error("expected completed work");
		expect(result.start.toString()).toBe("2026-07-20T08:00:00Z");
	});

	it("keeps an open appender without an end", () => {
		const result = interpret("2026-07-20T08:00:00Z", null, { durationSeconds: 120 });
		expect(result).toMatchObject({ kind: "open" });
		if (result.kind !== "open") throw new Error("expected open work");
		expect(result.start.toString()).toBe("2026-07-20T08:00:00Z");
	});

	it("holds equal or reversed endpoints instead of guessing", () => {
		expect(interpret("2026-07-20T08:00:00Z", "2026-07-20T08:00:00Z")).toEqual({
			kind: "held",
			hold: { reason: "invalid_interval", detail: "non_positive" },
		});
		expect(interpret("2026-07-20T09:00:00Z", "2026-07-20T08:00:00Z")).toEqual({
			kind: "held",
			hold: { reason: "invalid_interval", detail: "non_positive" },
		});
	});

	it("holds endpoints without an explicit offset or that cannot be parsed", () => {
		expect(interpret("2026-07-20T08:00:00", "2026-07-20T09:00:00Z")).toEqual({
			kind: "held",
			hold: { reason: "invalid_interval", detail: "start_not_exact" },
		});
		expect(interpret("2026-07-20T08:00:00Z", "tomorrow")).toEqual({
			kind: "held",
			hold: { reason: "invalid_interval", detail: "end_not_exact" },
		});
	});

	it("holds endpoints after the authoritative instant", () => {
		expect(interpret("2026-07-22T11:00:00Z", "2026-07-22T12:00:01Z")).toEqual({
			kind: "held",
			hold: { reason: "invalid_interval", detail: "future_endpoint" },
		});
		expect(interpret("2026-07-22T12:00:01Z", null)).toEqual({
			kind: "held",
			hold: { reason: "invalid_interval", detail: "future_endpoint" },
		});
		expect(interpret("2026-07-22T11:00:00Z", "2026-07-22T12:00:00Z")).toMatchObject({
			kind: "completed",
		});
	});

	it("accepts provider durations that agree exactly with the endpoints", () => {
		expect(
			interpret("2026-07-20T08:00:00Z", "2026-07-20T09:00:40Z", {
				durationSeconds: 3640,
				workSeconds: 3640,
				breakSeconds: 0,
				correctionSeconds: 0,
			}),
		).toMatchObject({ kind: "completed", durationMinutes: 61 });
	});

	it("holds a provider duration that disagrees with the endpoints", () => {
		const evidence = {
			durationSeconds: 3600,
			breakSeconds: null,
			workSeconds: null,
			correctionSeconds: null,
		};
		expect(interpret("2026-07-20T08:00:00Z", "2026-07-20T09:00:40Z", evidence)).toEqual({
			kind: "held",
			hold: { reason: "provider_duration_mismatch", elapsedSeconds: 3640, evidence },
		});
		expect(
			interpret("2026-07-20T08:00:00Z", "2026-07-20T09:00:00Z", { workSeconds: 3000 }),
		).toMatchObject({ kind: "held", hold: { reason: "provider_duration_mismatch" } });
	});

	it("holds a provider correction whose placement is unknown", () => {
		expect(
			interpret("2026-07-20T08:00:00Z", "2026-07-20T09:00:00Z", {
				durationSeconds: 3600,
				correctionSeconds: -300,
			}),
		).toMatchObject({ kind: "held", hold: { reason: "provider_duration_mismatch" } });
	});

	it("holds unlocated provider breaks for completed and open work", () => {
		expect(
			interpret("2026-07-20T08:00:00Z", "2026-07-20T17:00:00Z", {
				breakSeconds: 1800,
				workSeconds: 30600,
			}),
		).toEqual({
			kind: "held",
			hold: {
				reason: "unlocated_break",
				evidence: {
					durationSeconds: null,
					breakSeconds: 1800,
					workSeconds: 30600,
					correctionSeconds: null,
				},
			},
		});
		expect(interpret("2026-07-20T08:00:00Z", null, { breakSeconds: 60 })).toMatchObject({
			kind: "held",
			hold: { reason: "unlocated_break" },
		});
	});

	it("compares fractional elapsed seconds exactly", () => {
		expect(
			interpret("2026-07-20T08:00:00Z", "2026-07-20T08:01:00.500Z", { durationSeconds: 60 }),
		).toMatchObject({
			kind: "held",
			hold: { reason: "provider_duration_mismatch", elapsedSeconds: 60.5 },
		});
	});
});
