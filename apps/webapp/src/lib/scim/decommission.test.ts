import { describe, expect, it, vi } from "vitest";
import {
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
});
