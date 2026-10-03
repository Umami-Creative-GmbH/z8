import { describe, expect, it, vi } from "vitest";
import { isTeamsEnabledForOrganization } from "./tenant-resolver";

const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/db", () => ({ db: { query: { teamsTenantConfig: { findFirst } } } }));

describe("durable Teams tenant resolution", () => {
	it("propagates lookup failure only in strict mode and recovers after the database returns", async () => {
		findFirst.mockRejectedValue(new Error("lookup offline"));
		await expect(isTeamsEnabledForOrganization("org", { throwOnError: true })).rejects.toThrow(
			"lookup offline",
		);
		await expect(isTeamsEnabledForOrganization("org")).resolves.toBe(false);
		findFirst.mockResolvedValue({ organizationId: "org", setupStatus: "active" });
		await expect(isTeamsEnabledForOrganization("org", { throwOnError: true })).resolves.toBe(true);
		findFirst.mockResolvedValue(null);
		await expect(isTeamsEnabledForOrganization("org", { throwOnError: true })).resolves.toBe(false);
	});
});
