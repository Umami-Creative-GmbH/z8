import { describe, expect, it, vi } from "vitest";
import {
	runSCIMMaintenance,
	SCIMMaintenanceDegradedError,
} from "./scim-maintenance";

describe("runSCIMMaintenance", () => {
	it("runs strict outbox reconciliation and isolates projection recovery failures", async () => {
		const runOutbox = vi.fn().mockResolvedValue({
			claimed: 1,
			completed: 1,
			deferred: 0,
			exhausted: 0,
			persistenceFailures: 0,
		});
		const listDueRecoveryOrganizations = vi
			.fn()
			.mockResolvedValue(["org-one", "org-two"]);
		const retryProjectionRecovery = vi
			.fn()
			.mockRejectedValueOnce(new Error("replay failed"))
			.mockResolvedValueOnce(true);

		await expect(
			runSCIMMaintenance({
				runOutbox,
				listDueRecoveryOrganizations,
				retryProjectionRecovery,
				runDecommissions: vi.fn().mockResolvedValue("skipped"),
			}),
		).resolves.toEqual({
			outbox: {
				claimed: 1,
				completed: 1,
				deferred: 0,
				exhausted: 0,
				persistenceFailures: 0,
			},
			exhausted: 0,
			persistenceFailures: 0,
			projectionRecovery: { attempted: 2, recovered: 1, failed: 1 },
			decommission: { attempted: 0, completed: 0, deferred: 0, failed: 0 },
			failures: {
				outbox: 0,
				recoveryScan: 0,
				projectionRecovery: 1,
				decommission: 0,
			},
		});
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-one");
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-two");
	});

	it("throws a degraded result for terminal and persistence outbox failures", async () => {
		await expect(
			runSCIMMaintenance({
				runOutbox: vi.fn().mockResolvedValue({
					claimed: 2,
					completed: 0,
					deferred: 0,
					exhausted: 1,
					persistenceFailures: 1,
				}),
				listDueRecoveryOrganizations: vi.fn().mockResolvedValue([]),
				retryProjectionRecovery: vi.fn(),
				runDecommissions: vi.fn().mockResolvedValue("skipped"),
			}),
		).rejects.toMatchObject({
			name: "SCIMMaintenanceDegradedError",
			result: {
				outbox: { exhausted: 1, persistenceFailures: 1 },
				exhausted: 1,
				persistenceFailures: 1,
			},
		});
	});

	it("throws when the durable outbox scan fails", async () => {
		const scanFailure = new Error("database unavailable");

		await expect(
			runSCIMMaintenance({
				runOutbox: vi.fn().mockRejectedValue(scanFailure),
				listDueRecoveryOrganizations: vi.fn(),
				retryProjectionRecovery: vi.fn(),
				runDecommissions: vi.fn().mockResolvedValue("skipped"),
			}),
		).rejects.toMatchObject({
			name: "SCIMMaintenanceDegradedError",
			result: { failures: { outbox: 1 } },
		});
	});

	it("runs due decommissions even when seat or recovery work fails, then reports the seat failure", async () => {
		const scanFailure = new Error("database unavailable");
		const runDecommissions = vi
			.fn()
			.mockResolvedValueOnce("completed")
			.mockResolvedValueOnce("skipped");
		await expect(
			runSCIMMaintenance({
				runOutbox: vi.fn().mockRejectedValue(scanFailure),
				listDueRecoveryOrganizations: vi
					.fn()
					.mockRejectedValue(new Error("recovery scan failed")),
				retryProjectionRecovery: vi.fn(),
				runDecommissions,
			}),
		).rejects.toBeInstanceOf(SCIMMaintenanceDegradedError);
		expect(runDecommissions).toHaveBeenCalledTimes(2);
	});

	it("aggregates terminal phase failures after every maintenance phase runs", async () => {
		const runOutbox = vi.fn().mockRejectedValue(new Error("seat persistence failed"));
		const listDueRecoveryOrganizations = vi.fn().mockResolvedValue(["org-1"]);
		const retryProjectionRecovery = vi
			.fn()
			.mockRejectedValue(new Error("recovery persistence failed"));
		const runDecommissions = vi
			.fn()
			.mockRejectedValueOnce(new Error("decommission persistence failed"))
			.mockResolvedValueOnce("skipped");

		await expect(
			runSCIMMaintenance({
				runOutbox,
				listDueRecoveryOrganizations,
				retryProjectionRecovery,
				runDecommissions,
			}),
		).rejects.toMatchObject({
			name: "SCIMMaintenanceDegradedError",
			result: {
				projectionRecovery: { attempted: 1, failed: 1 },
				decommission: { attempted: 1, failed: 1 },
			},
		});
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-1");
		expect(runDecommissions).toHaveBeenCalledTimes(2);
	});

	it("runs due decommissions after recovery work and isolates each failure", async () => {
		const runDecommissions = vi
			.fn()
			.mockResolvedValueOnce("completed")
			.mockRejectedValueOnce(new Error("retry persistence failed"))
			.mockResolvedValueOnce("skipped");

		await expect(
			runSCIMMaintenance({
				runOutbox: vi.fn().mockResolvedValue({
					claimed: 0,
					completed: 0,
					deferred: 0,
					exhausted: 0,
					persistenceFailures: 0,
				}),
				listDueRecoveryOrganizations: vi.fn().mockResolvedValue([]),
				retryProjectionRecovery: vi.fn(),
				runDecommissions,
			}),
		).rejects.toMatchObject({
			name: "SCIMMaintenanceDegradedError",
			result: {
				decommission: { attempted: 2, completed: 1, deferred: 0, failed: 1 },
			},
		});
	});

	it("resumes a deferred decommission on the next cron run without changing seat degradation", async () => {
		const runDecommissions = vi
			.fn()
			.mockResolvedValueOnce("deferred")
			.mockResolvedValueOnce("skipped")
			.mockResolvedValueOnce("completed")
			.mockResolvedValueOnce("skipped");
		const dependencies = {
			runOutbox: vi.fn().mockResolvedValue({
				claimed: 0,
				completed: 0,
				deferred: 0,
				exhausted: 0,
				persistenceFailures: 0,
			}),
			listDueRecoveryOrganizations: vi.fn().mockResolvedValue([]),
			retryProjectionRecovery: vi.fn(),
			runDecommissions,
		};

		await expect(runSCIMMaintenance(dependencies)).resolves.toMatchObject({
			decommission: { attempted: 1, deferred: 1, completed: 0, failed: 0 },
			exhausted: 0,
			persistenceFailures: 0,
		});
		await expect(runSCIMMaintenance(dependencies)).resolves.toMatchObject({
			decommission: { attempted: 1, deferred: 0, completed: 1, failed: 0 },
			exhausted: 0,
			persistenceFailures: 0,
		});
	});
});
