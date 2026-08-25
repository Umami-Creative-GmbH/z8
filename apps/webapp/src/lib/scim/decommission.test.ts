import { describe, expect, it, vi } from "vitest";
import {
	beginSCIMDecommission,
	createSCIMDecommissionStore,
	runDueSCIMDecommission,
	type SCIMDecommissionStore,
} from "./decommission";

const now = new Date("2026-08-25T00:00:00.000Z");
const claim = {
	organizationId: "org-1",
	connectionId: "connection-1",
	actorId: "actor-1",
	retryAt: now,
};

describe("SCIM decommission", () => {
	it("persists Better Auth's exact reconciling retry time and never completes early", async () => {
		const store: SCIMDecommissionStore = {
			claimDue: vi.fn().mockResolvedValue(claim),
			complete: vi.fn(),
			defer: vi.fn(),
		};
		const retryAfter = new Date("2026-08-25T01:00:00.000Z");
		const decommissionSCIMManagedConnection = vi.fn().mockResolvedValue({
			decommission: { status: "reconciling", retryAfter },
		});

		await expect(
			runDueSCIMDecommission({
				store,
				auth: { api: { decommissionSCIMManagedConnection } },
				now,
			}),
		).resolves.toBe("deferred");
		expect(decommissionSCIMManagedConnection).toHaveBeenCalledWith({
			body: {
				connectionId: "connection-1",
				provisioningDomainId: "org-1",
				actorId: "actor-1",
			},
		});
		expect(store.defer).toHaveBeenCalledWith(claim, retryAfter, null);
		expect(store.complete).not.toHaveBeenCalled();
	});

	it("uses a bounded retry for infrastructure failures and fences completion", async () => {
		const store: SCIMDecommissionStore = {
			claimDue: vi.fn().mockResolvedValue(claim),
			complete: vi.fn(),
			defer: vi.fn(),
		};
		await expect(
			runDueSCIMDecommission({
				store,
				auth: {
					api: {
						decommissionSCIMManagedConnection: vi
							.fn()
							.mockRejectedValue(new Error("network token=secret")),
					},
				},
				now,
			}),
		).resolves.toBe("deferred");
		expect(store.defer).toHaveBeenCalledWith(
			claim,
			new Date("2026-08-25T00:00:30.000Z"),
			"SCIM decommission failed",
		);
	});

	it("skips a decommission whose persisted retry time is not yet due", async () => {
		const store: SCIMDecommissionStore = {
			claimDue: vi.fn().mockResolvedValue(null),
			complete: vi.fn(),
			defer: vi.fn(),
		};
		const decommissionSCIMManagedConnection = vi.fn();
		await expect(
			runDueSCIMDecommission({
				store,
				auth: { api: { decommissionSCIMManagedConnection } },
				now,
			}),
		).resolves.toBe("skipped");
		expect(decommissionSCIMManagedConnection).not.toHaveBeenCalled();
	});

	it("only transitions the matching active row to decommissioning before external work", async () => {
		const execute = vi
			.fn()
			.mockResolvedValueOnce({ rows: [{ id: "config-1" }] });
		await expect(
			beginSCIMDecommission({
				database: { execute },
				organizationId: "org-1",
				connectionId: "connection-1",
				actorId: "actor-1",
				now,
			}),
		).resolves.toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("rejects completion or retry persistence after a competing lease wins", async () => {
		const execute = vi.fn().mockResolvedValue({ rows: [] });
		const store = createSCIMDecommissionStore({ execute });
		await expect(store.complete(claim, now)).rejects.toThrow(
			"lease is no longer owned",
		);
		await expect(store.defer(claim, now, null)).rejects.toThrow(
			"lease is no longer owned",
		);
	});
});
