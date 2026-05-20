import { describe, expect, it } from "vitest";
import { canSelfCancelAbsenceStatus } from "./permissions";

describe("canSelfCancelAbsenceStatus", () => {
	const today = "2026-05-20";

	it("allows pending absences regardless of start date", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "pending", startDate: "2026-05-19", today }),
		).toBe(true);
	});

	it("allows approved absences only before the start date", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-21", today }),
		).toBe(true);
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-20", today }),
		).toBe(false);
		expect(
			canSelfCancelAbsenceStatus({ status: "approved", startDate: "2026-05-19", today }),
		).toBe(false);
	});

	it("rejects rejected absences", () => {
		expect(
			canSelfCancelAbsenceStatus({ status: "rejected", startDate: "2026-05-21", today }),
		).toBe(false);
	});
});
