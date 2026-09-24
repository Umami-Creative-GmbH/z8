import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { evaluateEscalationDeadline } from "./deadline";

const actionableAt = Temporal.Instant.from("2026-03-28T20:00:00Z");
const policy = { enabled: true, responseWindowHours: 24, revision: 3 };

describe("evaluateEscalationDeadline", () => {
	it("becomes due exactly at the deadline and not a moment earlier", () => {
		const deadline = Temporal.Instant.from("2026-03-29T20:00:00Z");

		expect(
			evaluateEscalationDeadline({
				actionableAt,
				policy,
				now: deadline.subtract({ nanoseconds: 1 }),
			}),
		).toEqual({ kind: "not_due", deadline, policyRevision: 3 });
		expect(
			evaluateEscalationDeadline({ actionableAt, policy, now: deadline }),
		).toEqual({
			kind: "due",
			deadline,
			policyRevision: 3,
		});
	});

	it("measures elapsed hours without zone or DST meaning", () => {
		// 2026-03-29 is the Europe/Berlin spring-forward date; the window stays 24 elapsed hours.
		const result = evaluateEscalationDeadline({
			actionableAt,
			policy,
			now: Temporal.Instant.from("2026-03-29T19:30:00Z"),
		});

		expect(result.kind).toBe("not_due");
		expect(result.kind !== "disabled" && result.deadline.toString()).toBe(
			"2026-03-29T20:00:00Z",
		);
	});

	it("moves the deadline on policy edits without restarting the actionable clock", () => {
		const now = Temporal.Instant.from("2026-03-29T10:00:00Z");
		const before = evaluateEscalationDeadline({ actionableAt, policy, now });
		const shortened = evaluateEscalationDeadline({
			actionableAt,
			policy: { enabled: true, responseWindowHours: 8, revision: 4 },
			now,
		});
		const lengthened = evaluateEscalationDeadline({
			actionableAt,
			policy: { enabled: true, responseWindowHours: 48, revision: 5 },
			now,
		});

		expect(before.kind).toBe("not_due");
		expect(shortened).toEqual({
			kind: "due",
			deadline: Temporal.Instant.from("2026-03-29T04:00:00Z"),
			policyRevision: 4,
		});
		expect(lengthened).toEqual({
			kind: "not_due",
			deadline: Temporal.Instant.from("2026-03-30T20:00:00Z"),
			policyRevision: 5,
		});
	});

	it("reports disabled policies with the evaluated revision", () => {
		expect(
			evaluateEscalationDeadline({
				actionableAt,
				policy: { enabled: false, responseWindowHours: 1, revision: 7 },
				now: Temporal.Instant.from("2027-01-01T00:00:00Z"),
			}),
		).toEqual({ kind: "disabled", policyRevision: 7 });
	});
});
