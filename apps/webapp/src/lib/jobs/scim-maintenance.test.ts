import { describe, expect, it, vi } from "vitest";
import { runSCIMMaintenance } from "./scim-maintenance";

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
		});
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-one");
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-two");
	});

	it("returns terminal and persistence failure outcomes from outbox processing", async () => {
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
		).resolves.toMatchObject({
			outbox: { exhausted: 1, persistenceFailures: 1 },
			exhausted: 1,
			persistenceFailures: 1,
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
		).rejects.toThrow(scanFailure);
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
		).resolves.toMatchObject({
			decommission: { attempted: 2, completed: 1, deferred: 0, failed: 1 },
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
			runOutbox: vi
				.fn()
				.mockResolvedValue({
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
