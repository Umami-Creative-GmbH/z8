import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: { BILLING_ENABLED: "false" },
	headers: vi.fn(),
	getSession: vi.fn(),
	requirePlatformAdmin: vi.fn(),
	syncSeatsForOrganization: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: mockState.env,
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/effect/services/platform-admin.service", async () => {
	const { Context, Effect, Layer } = await import("effect");

	class PlatformAdminService extends Context.Tag("PlatformAdminService")<
		PlatformAdminService,
		{
			readonly requirePlatformAdmin: () => Effect.Effect<
				{ userId: string; email: string },
				unknown
			>;
		}
	>() {}

	const PlatformAdminServiceLive = Layer.succeed(
		PlatformAdminService,
		PlatformAdminService.of({
			requirePlatformAdmin: () =>
				Effect.tryPromise({
					try: () => mockState.requirePlatformAdmin(),
					catch: (error) => error,
				}),
		}),
	);

	return { PlatformAdminService, PlatformAdminServiceLive };
});

vi.mock("@/lib/effect/services/billing", async () => {
	const { Context, Effect, Layer } = await import("effect");

	class SeatSyncService extends Context.Tag("SeatSyncService")<
		SeatSyncService,
		{
			readonly syncSeatsForOrganization: (organizationId: string) => Effect.Effect<number, unknown>;
		}
	>() {}

	const SeatSyncServiceLive = Layer.succeed(
		SeatSyncService,
		SeatSyncService.of({
			syncSeatsForOrganization: (organizationId) =>
				Effect.tryPromise({
					try: () => mockState.syncSeatsForOrganization(organizationId),
					catch: (error) => error,
				}),
		}),
	);

	return {
		SeatSyncService,
		SeatSyncServiceLive,
		StripeServiceLive: Layer.empty,
		SubscriptionServiceLive: Layer.empty,
	};
});

async function importActions() {
	return await import("./actions");
}

describe("syncOrganizationSeatsAction", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		mockState.env.BILLING_ENABLED = "false";
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue(null);
		mockState.requirePlatformAdmin.mockResolvedValue({
			userId: "admin-1",
			email: "admin@example.com",
		});
		mockState.syncSeatsForOrganization.mockResolvedValue(7);
	});

	it("returns disabled without checking auth or syncing when billing is disabled", async () => {
		const { syncOrganizationSeatsAction } = await importActions();

		const result = await syncOrganizationSeatsAction("org-disabled");

		expect(result).toEqual({ success: false, error: "Billing is disabled" });
		expect(mockState.headers).not.toHaveBeenCalled();
		expect(mockState.getSession).not.toHaveBeenCalled();
		expect(mockState.requirePlatformAdmin).not.toHaveBeenCalled();
		expect(mockState.syncSeatsForOrganization).not.toHaveBeenCalled();
	});

	it("returns unauthorized when billing is enabled and no session user exists", async () => {
		mockState.env.BILLING_ENABLED = "true";
		const { AuthorizationError } = await import("@/lib/effect/errors");
		mockState.requirePlatformAdmin.mockRejectedValue(
			new AuthorizationError({ message: "Platform admin access required" }),
		);
		const { syncOrganizationSeatsAction } = await importActions();

		const result = await syncOrganizationSeatsAction("org-unauthorized");

		expect(result).toEqual({ success: false, error: "Platform admin access required" });
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.syncSeatsForOrganization).not.toHaveBeenCalled();
	});

	it("returns forbidden when the session user is not a platform admin", async () => {
		mockState.env.BILLING_ENABLED = "true";
		const { AuthorizationError } = await import("@/lib/effect/errors");
		mockState.requirePlatformAdmin.mockRejectedValue(
			new AuthorizationError({ message: "Platform admin access required" }),
		);
		const { syncOrganizationSeatsAction } = await importActions();

		const result = await syncOrganizationSeatsAction("org-forbidden");

		expect(result).toEqual({ success: false, error: "Platform admin access required" });
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.syncSeatsForOrganization).not.toHaveBeenCalled();
	});

	it("rejects banned platform admins before syncing seats", async () => {
		mockState.env.BILLING_ENABLED = "true";
		const { AuthorizationError } = await import("@/lib/effect/errors");
		mockState.requirePlatformAdmin.mockRejectedValue(
			new AuthorizationError({ message: "Platform admin access required" }),
		);
		const { syncOrganizationSeatsAction } = await importActions();

		const result = await syncOrganizationSeatsAction("org-banned");

		expect(result).toEqual({ success: false, error: "Platform admin access required" });
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.syncSeatsForOrganization).not.toHaveBeenCalled();
	});

	it("syncs seats for the requested organization when billing is enabled and user is admin", async () => {
		mockState.env.BILLING_ENABLED = "true";
		mockState.syncSeatsForOrganization.mockResolvedValue(12);
		const { syncOrganizationSeatsAction } = await importActions();

		const result = await syncOrganizationSeatsAction("org-success");

		expect(result).toEqual({ success: true, seats: 12 });
		expect(mockState.requirePlatformAdmin).toHaveBeenCalledTimes(1);
		expect(mockState.syncSeatsForOrganization).toHaveBeenCalledTimes(1);
		expect(mockState.syncSeatsForOrganization).toHaveBeenCalledWith("org-success");
	});

	it("returns a safe error message when seat sync fails", async () => {
		mockState.env.BILLING_ENABLED = "true";
		mockState.syncSeatsForOrganization.mockRejectedValue(new Error("Stripe sync failed"));
		const { syncOrganizationSeatsAction } = await importActions();

		const result = await syncOrganizationSeatsAction("org-failure");

		expect(result).toEqual({ success: false, error: "Failed to sync seats" });
	});
});
