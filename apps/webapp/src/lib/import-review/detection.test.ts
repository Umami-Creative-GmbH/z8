import { describe, expect, it } from "vitest";
import { classifyTimeWindow, createDuplicateIssue, detectMissingMapping } from "./detection";

describe("import review detection", () => {
	it("creates duplicate issues with a stable cluster key", () => {
		const issue = createDuplicateIssue({
			entityType: "work_period",
			employeeId: "emp_1",
			sourceId: "src_1",
			startsAt: "2026-01-01T08:00:00.000Z",
		});

		expect(issue.issueType).toBe("duplicate");
		expect(issue.severity).toBe("warning");
		expect(issue.clusterKey).toBe("duplicate:work_period:emp_1:2026-01-01T08:00:00.000Z");
	});

	it("marks rows without employee mapping as blocking", () => {
		const issue = detectMissingMapping({ entityType: "absence", providerSourceId: "a_1", employeeId: null });

		expect(issue).toMatchObject({ issueType: "unmatched_employee", severity: "blocking" });
	});

	it("detects missing clock-out and invalid durations", () => {
		expect(classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: null })).toContain("missing_clock_out");
		expect(
			classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: "2026-01-01T08:00:00.000Z" }),
		).toContain("non_positive_duration");
		expect(
			classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: "2026-01-02T09:00:00.000Z" }),
		).toContain("long_shift");
	});

	it("detects invalid time window dates", () => {
		expect(classifyTimeWindow({ startsAt: "not-a-date", endsAt: "2026-01-01T08:00:00.000Z" })).toContain("invalid_start");
		expect(classifyTimeWindow({ startsAt: "2026-01-01T08:00:00.000Z", endsAt: "not-a-date" })).toContain("invalid_end");
	});

	it("classifies day boundaries in UTC for timestamps with explicit offsets", () => {
		expect(
			classifyTimeWindow({ startsAt: "2026-01-01T23:30:00-02:00", endsAt: "2026-01-02T00:30:00-02:00" }),
		).not.toContain("crosses_day_boundary");
		expect(
			classifyTimeWindow({ startsAt: "2026-01-01T23:30:00+00:00", endsAt: "2026-01-02T00:30:00+00:00" }),
		).toContain("crosses_day_boundary");
	});
});
