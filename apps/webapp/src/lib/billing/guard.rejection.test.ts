import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/effect/errors";

const mockState = vi.hoisted(() => ({
	env: { BILLING_ENABLED: "true" },
	provisionLocalTrial: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mockState.env }));
vi.mock("@/lib/effect/services/billing/billing-configuration", () => ({
	provisionLocalTrial: mockState.provisionLocalTrial,
}));
vi.mock("@/lib/effect/runtime", async () =>
	(await import("@/test/effect-runtime")).runtimeModuleOver(
		(await import("@/lib/effect/services/database.service")).DatabaseServiceLive,
	),
);

const { requireBillingForMutation } = await import("./guard");

describe("requireBillingForMutation rejection", () => {
	beforeEach(() => {
		mockState.provisionLocalTrial.mockReset();
	});

	it("rejects with the DatabaseError itself when the billing check fails", async () => {
		mockState.provisionLocalTrial.mockRejectedValue(new Error("connection refused"));

		const rejection = requireBillingForMutation("org-1");

		await expect(rejection).rejects.toBeInstanceOf(DatabaseError);
		await expect(rejection).rejects.toMatchObject({
			_tag: "DatabaseError",
			message: "Database query failed: billing.checkAccess",
			operation: "billing.checkAccess",
			cause: expect.objectContaining({ message: "connection refused" }),
		});
	});
});
