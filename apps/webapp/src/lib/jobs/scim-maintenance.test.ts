import { describe, expect, it, vi } from "vitest";
import { runSCIMMaintenance } from "./scim-maintenance";

describe("runSCIMMaintenance", () => {
	it("runs strict outbox reconciliation and isolates projection recovery failures", async () => {
		const runOutbox = vi
			.fn()
			.mockResolvedValue({ claimed: 1, completed: 1, deferred: 0 });
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
			}),
		).resolves.toEqual({
			outbox: { claimed: 1, completed: 1, deferred: 0 },
			projectionRecovery: { attempted: 2, recovered: 1, failed: 1 },
		});
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-one");
		expect(retryProjectionRecovery).toHaveBeenCalledWith("org-two");
	});

	it("throws when the durable outbox scan fails", async () => {
		const scanFailure = new Error("database unavailable");

		await expect(
			runSCIMMaintenance({
				runOutbox: vi.fn().mockRejectedValue(scanFailure),
				listDueRecoveryOrganizations: vi.fn(),
				retryProjectionRecovery: vi.fn(),
			}),
		).rejects.toThrow(scanFailure);
	});
});
