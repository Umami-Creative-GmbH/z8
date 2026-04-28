import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { getQualificationStatus, mergeRequirementMode } from "../status";

describe("getQualificationStatus", () => {
	it("marks a qualification without expiry as valid", () => {
		expect(getQualificationStatus({ expiresAt: null, warningDays: 30 })).toBe("valid");
	});

	it("marks a past expiry date as expired", () => {
		const now = DateTime.fromISO("2026-04-28T12:00:00Z");
		expect(
			getQualificationStatus({
				expiresAt: DateTime.fromISO("2026-04-27T00:00:00Z").toJSDate(),
				warningDays: 30,
				now,
			}),
		).toBe("expired");
	});

	it("marks an expiry within the warning window as expiringSoon", () => {
		const now = DateTime.fromISO("2026-04-28T12:00:00Z");
		expect(
			getQualificationStatus({
				expiresAt: DateTime.fromISO("2026-05-10T00:00:00Z").toJSDate(),
				warningDays: 14,
				now,
			}),
		).toBe("expiringSoon");
	});

	it("marks a future expiry outside the warning window as valid", () => {
		const now = DateTime.fromISO("2026-04-28T12:00:00Z");
		expect(
			getQualificationStatus({
				expiresAt: DateTime.fromISO("2026-06-01T00:00:00Z").toJSDate(),
				warningDays: 14,
				now,
			}),
		).toBe("valid");
	});
});

describe("mergeRequirementMode", () => {
	it("keeps blocking when any duplicate requirement is blocking", () => {
		expect(mergeRequirementMode("warning", "blocking")).toBe("blocking");
		expect(mergeRequirementMode("blocking", "warning")).toBe("blocking");
	});

	it("keeps warning when both duplicate requirements are warning", () => {
		expect(mergeRequirementMode("warning", "warning")).toBe("warning");
	});
});
