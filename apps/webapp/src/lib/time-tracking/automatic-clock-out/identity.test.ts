import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { deriveAutoClockOutOperationId } from "./identity";
import type { AutoClockOutDecision } from "./types";

const decision: Omit<AutoClockOutDecision, "operationId"> = {
	organizationId: "organization",
	employeeId: "employee",
	workPeriodId: "period",
	start: parseInstant("2026-10-24T18:00:00Z"),
	cutoff: parseInstant("2026-10-25T06:00:00Z"),
	settings: { autoClockOutEnabled: true, maxUninterruptedMinutes: 720, revision: 0 },
	timezone: "Europe/Berlin",
	provenanceUserId: "creator",
};

describe("automatic clock-out operation identity", () => {
	it("canonicalizes equivalent instants and ignores unrelated capture facts", () => {
		const id = deriveAutoClockOutOperationId(decision);
		expect(id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
		expect(
			deriveAutoClockOutOperationId({
				...decision,
				start: parseInstant("2026-10-24T20:00:00+02:00"),
				timezone: "UTC",
				provenanceUserId: "other",
			}),
		).toBe(id);
	});
	it("separates each tenant, employee, period, start, cutoff and settings revision", () => {
		const variants = [
			decision,
			...["organizationId", "employeeId", "workPeriodId"].map((key) => ({
				...decision,
				[key]: "other",
			})),
			{ ...decision, start: decision.start.add({ seconds: 1 }) },
			{ ...decision, cutoff: decision.cutoff.add({ seconds: 1 }) },
			{ ...decision, settings: { ...decision.settings, revision: 1 } },
		];
		expect(new Set(variants.map(deriveAutoClockOutOperationId)).size).toBe(7);
	});
});
