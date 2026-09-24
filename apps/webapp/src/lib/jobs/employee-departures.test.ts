import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DepartureIdentity } from "@/lib/employee-lifecycle/types";
import { runEmployeeDepartureMaintenanceWith } from "./employee-departures";

const identity = (departureId: string, organizationId = "org-1"): DepartureIdentity => ({
	organizationId,
	employeeId: `employee-${departureId}`,
	employmentPeriodId: `period-${departureId}`,
	departureId,
	revision: 1,
});

const noTasks = { claimed: 0, completed: 0, deferred: 0, failed: 0 };

describe("runEmployeeDepartureMaintenanceWith", () => {
	it("does nothing while the offboarding release gate is closed", async () => {
		const listDueDepartures = vi.fn();
		const deliverTasks = vi.fn();

		const result = await runEmployeeDepartureMaintenanceWith({
			released: false,
			clock: { nowInstant: () => parseInstant("2026-09-15T00:01:00Z") },
			listDueDepartures,
			executeDeparture: vi.fn(),
			deliverTasks,
		});

		expect(result).toMatchObject({ released: false });
		expect(listDueDepartures).not.toHaveBeenCalled();
		expect(deliverTasks).not.toHaveBeenCalled();
	});

	it("executes due departures in order, isolating failures, then delivers follow-up work", async () => {
		const due = [identity("a"), identity("b"), identity("c", "org-2"), identity("d")];
		const executeDeparture = vi
			.fn()
			.mockResolvedValueOnce({ status: "effective", departureId: "a", followUpPending: true })
			.mockRejectedValueOnce(new Error("deadlock detected"))
			.mockResolvedValueOnce({
				status: "blocked",
				departureId: "c",
				reason: "final_accessible_owner",
			})
			.mockResolvedValueOnce({ status: "obsolete" });
		const deliverTasks = vi.fn().mockResolvedValue({ ...noTasks, claimed: 2, completed: 2 });
		const now = parseInstant("2026-09-15T00:01:00Z");

		const result = await runEmployeeDepartureMaintenanceWith({
			released: true,
			clock: { nowInstant: () => now },
			listDueDepartures: vi.fn().mockResolvedValue(due),
			executeDeparture,
			deliverTasks,
		});

		expect(executeDeparture.mock.calls.map(([called]) => called.departureId)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(result).toEqual({
			released: true,
			departures: { processed: 4, effective: 1, blocked: 1, obsolete: 1, notDue: 0, failed: 1 },
			tasks: { ...noTasks, claimed: 2, completed: 2 },
			errors: [{ organizationId: "org-1", departureId: "b", error: "deadlock detected" }],
		});
		expect(deliverTasks).toHaveBeenCalledWith(now);
	});
});
