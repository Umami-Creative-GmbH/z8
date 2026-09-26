import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type AmendmentIntent,
	AmendmentNoChangeError,
	AmendmentRangeError,
	type AmendmentSource,
	planAttributionChange,
	planCompletedWorkAmendment,
} from "./amend-completed-work-plan";
import { WorkIntervalError } from "./work-duration";

const start = parseInstant("2026-07-22T08:00:00Z");
const end = parseInstant("2026-07-22T16:00:00Z");
const source: AmendmentSource = {
	startAt: start,
	endAt: end,
	// Protected historical minutes: floored by an older writer.
	durationMinutes: 479,
	projectId: "project-a",
	workCategoryId: "category-a",
	workLocationType: "home",
};
const preserveAll: AmendmentIntent = {
	clockIn: { kind: "preserve" },
	clockOut: { kind: "preserve" },
	project: { kind: "preserve" },
	workCategory: { kind: "preserve" },
	workLocation: { kind: "preserve" },
};

function plan(intent: Partial<AmendmentIntent>) {
	return planCompletedWorkAmendment(source, { ...preserveAll, ...intent });
}

describe("planCompletedWorkAmendment", () => {
	it("derives fresh minutes from the exact UTC endpoints when an endpoint moves", () => {
		const result = plan({
			clockOut: { kind: "set", at: end.add({ seconds: 40 }), precision: "exact" },
		});
		expect(result.changes).toEqual({
			clockIn: false,
			clockOut: true,
			project: false,
			workCategory: false,
			workLocation: false,
		});
		expect(result.result.durationMinutes).toBe(481);
		expect(result.result.endAt.equals(end.add({ seconds: 40 }))).toBe(true);
	});

	it("treats an endpoint set to its current instant as unchanged", () => {
		const result = plan({
			clockIn: { kind: "set", at: start, precision: "exact" },
			clockOut: { kind: "set", at: end.add({ minutes: 5 }), precision: "exact" },
		});
		expect(result.changes.clockIn).toBe(false);
		expect(result.changes.clockOut).toBe(true);
		expect(result.result.durationMinutes).toBe(485);
	});

	it("keeps the exact stored instant when a minute-precision value is its displayed minute", () => {
		const withSeconds = {
			...source,
			startAt: start.add({ seconds: 40 }),
			endAt: end.add({ seconds: 20 }),
		};
		const result = planCompletedWorkAmendment(withSeconds, {
			...preserveAll,
			clockIn: { kind: "set", at: start, precision: "minute" },
			clockOut: { kind: "set", at: end.add({ minutes: 30 }), precision: "minute" },
		});
		expect(result.changes.clockIn).toBe(false);
		expect(result.result.startAt.equals(start.add({ seconds: 40 }))).toBe(true);
		expect(result.changes.clockOut).toBe(true);
		expect(result.result.endAt.equals(end.add({ minutes: 30 }))).toBe(true);
		// 8h29m20s rounds half up to 509 minutes.
		expect(result.result.durationMinutes).toBe(509);
	});

	it("keeps protected historical minutes for metadata-only changes", () => {
		const result = plan({ workCategory: { kind: "replace", id: "category-b" } });
		expect(result.result.durationMinutes).toBe(479);
		expect(result.result.workCategoryId).toBe("category-b");
		expect(result.result.projectId).toBe("project-a");
		expect(result.result.workLocationType).toBe("home");
	});

	it("distinguishes omission, explicit clearing and replacement", () => {
		expect(plan({ project: { kind: "clear" } }).result.projectId).toBeNull();
		expect(plan({ project: { kind: "replace", id: "project-b" } }).result.projectId).toBe(
			"project-b",
		);
		const preserved = plan({ workLocation: { kind: "replace", id: "remote" } });
		expect(preserved.result.projectId).toBe("project-a");
		expect(preserved.result.workCategoryId).toBe("category-a");
		expect(preserved.changes.project).toBe(false);
	});

	it("treats a replacement equal to the current value as unchanged", () => {
		expect(() =>
			plan({
				project: { kind: "replace", id: "project-a" },
				workLocation: { kind: "replace", id: "home" },
			}),
		).toThrow(AmendmentNoChangeError);
	});

	it("compares a submitted location with the normalized legacy location", () => {
		const legacy = { ...source, workLocationType: null };
		expect(() =>
			planCompletedWorkAmendment(legacy, {
				...preserveAll,
				workLocation: { kind: "replace", id: "office" },
			}),
		).toThrow(AmendmentNoChangeError);
	});

	it("rejects an amendment that changes nothing", () => {
		expect(() => plan({})).toThrow(AmendmentNoChangeError);
	});

	it("rejects equal or reversed resulting endpoints", () => {
		expect(() => plan({ clockOut: { kind: "set", at: start, precision: "exact" } })).toThrow(
			WorkIntervalError,
		);
		expect(() =>
			plan({ clockIn: { kind: "set", at: end.add({ seconds: 1 }), precision: "exact" } }),
		).toThrow(WorkIntervalError);
	});

	it("rejects work longer than 24 hours", () => {
		expect(() =>
			plan({
				clockOut: { kind: "set", at: start.add({ hours: 24, seconds: 1 }), precision: "exact" },
			}),
		).toThrow(AmendmentRangeError);
	});

	it("plans attribution-only changes of active work without endpoints", () => {
		const attribution = {
			projectId: "project-a",
			workCategoryId: null,
			workLocationType: "office",
		};
		expect(
			planAttributionChange(attribution, {
				project: { kind: "replace", id: "project-b" },
				workCategory: { kind: "preserve" },
				workLocation: { kind: "preserve" },
			}),
		).toEqual({
			changes: { project: true, workCategory: false, workLocation: false },
			result: { projectId: "project-b", workCategoryId: null, workLocationType: "office" },
		});
		expect(() =>
			planAttributionChange(attribution, {
				project: { kind: "replace", id: "project-a" },
				workCategory: { kind: "clear" },
				workLocation: { kind: "preserve" },
			}),
		).toThrow(AmendmentNoChangeError);
	});

	it("rejects an unknown work location", () => {
		expect(() => plan({ workLocation: { kind: "replace", id: "moon" } })).toThrow(
			AmendmentRangeError,
		);
	});
});
