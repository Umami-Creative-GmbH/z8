import { describe, expect, it } from "vitest";
import { importedWorkProviderEvidence } from "./imported-work-evidence";

describe("importedWorkProviderEvidence", () => {
	it("reads Clockodo duration and time correction from the retained source payload", () => {
		expect(
			importedWorkProviderEvidence("clockodo", {
				id: 7,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T09:00:00Z",
				duration: 3600,
				offset: -120,
			}),
		).toEqual({
			durationSeconds: 3600,
			breakSeconds: null,
			workSeconds: null,
			correctionSeconds: -120,
		});
	});

	it("reads Clockin break and work seconds from the retained source payload", () => {
		expect(
			importedWorkProviderEvidence("clockin", {
				employee_id: 3,
				starts_at: "2026-01-03T08:00:00Z",
				ends_at: "2026-01-03T17:00:00Z",
				break_seconds: 1800,
				work_seconds: 30600,
				target_seconds: 28800,
			}),
		).toEqual({
			durationSeconds: null,
			breakSeconds: 1800,
			workSeconds: 30600,
			correctionSeconds: null,
		});
	});

	it("records absent or non-numeric provider fields as not stated", () => {
		expect(importedWorkProviderEvidence("clockodo", { duration: "3600", offset: null })).toEqual({
			durationSeconds: null,
			breakSeconds: null,
			workSeconds: null,
			correctionSeconds: null,
		});
		expect(importedWorkProviderEvidence("clockin", {})).toEqual({
			durationSeconds: null,
			breakSeconds: null,
			workSeconds: null,
			correctionSeconds: null,
		});
	});
});
