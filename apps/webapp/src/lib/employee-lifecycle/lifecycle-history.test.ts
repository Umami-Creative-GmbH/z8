import { describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { mergeLifecycleHistory } from "./lifecycle-history";

describe("employment history: deactivations and reactivations", () => {
	it("shows recorded events and the audit entries of older ones, newest first, each once", () => {
		const events = mergeLifecycleHistory({
			records: [
				{
					kind: "employee_deactivated",
					at: parseInstant("2026-10-24T08:00:00Z"),
					requestId: "request-deactivate",
					deactivationId: "deactivation-1",
				},
				{
					kind: "employee_reactivated",
					at: parseInstant("2026-10-26T07:30:00Z"),
					requestId: "request-reactivate",
					deactivationId: "deactivation-1",
				},
			],
			audits: [
				// The same deactivation and reactivation, also audited: shown once.
				{
					action: "employee.deactivated",
					at: parseInstant("2026-10-24T08:00:01Z"),
					metadata: { deactivationId: "deactivation-1" },
				},
				{
					action: "employee.reactivated",
					at: parseInstant("2026-10-26T07:30:01Z"),
					metadata: { reactivationRequestId: "request-reactivate" },
				},
				// An earlier deactivation, from before the events were recorded.
				{
					action: "employee.deactivated",
					at: parseInstant("2026-03-02T09:15:00Z"),
					metadata: { actorEmail: "owner@example.com" },
				},
				{
					action: "employee.reactivated",
					at: parseInstant("2026-03-09T09:15:00Z"),
					metadata: {},
				},
			],
		});

		expect(events).toEqual([
			{ kind: "reactivated", at: "2026-10-26T07:30:00Z" },
			{ kind: "deactivated", at: "2026-10-24T08:00:00Z" },
			{ kind: "reactivated", at: "2026-03-09T09:15:00Z" },
			{ kind: "deactivated", at: "2026-03-02T09:15:00Z" },
		]);
	});

	it("keeps an audited deactivation that recorded no event (no employment period)", () => {
		expect(
			mergeLifecycleHistory({
				records: [],
				audits: [
					{
						action: "employee.deactivated",
						at: parseInstant("2026-10-24T08:00:01Z"),
						metadata: { deactivationId: "deactivation-without-period" },
					},
				],
			}),
		).toEqual([{ kind: "deactivated", at: "2026-10-24T08:00:01Z" }]);
	});
});
