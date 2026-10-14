import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserPrimaryOrganizationId, onPasswordChanged, onTwoFactorEnabled, onTwoFactorDisabled } =
	vi.hoisted(() => ({
		getUserPrimaryOrganizationId: vi.fn(),
		onPasswordChanged: vi.fn(),
		onTwoFactorEnabled: vi.fn(),
		onTwoFactorDisabled: vi.fn(),
	}));

vi.mock("@/lib/auth/primary-organization", () => ({ getUserPrimaryOrganizationId }));
vi.mock("./triggers", () => ({ onPasswordChanged, onTwoFactorEnabled, onTwoFactorDisabled }));

import { notifySecurityAlert } from "./security-alert-notifier";

const client = { ipAddress: "203.0.113.7", userAgent: "Synthetic Browser/1.0" };

describe("notifySecurityAlert (#1180)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getUserPrimaryOrganizationId.mockResolvedValue("org-primary");
	});

	it.each([
		["password_changed", onPasswordChanged],
		["two_factor_enabled", onTwoFactorEnabled],
		["two_factor_disabled", onTwoFactorDisabled],
	] as const)(
		"sends %s to the user's primary organization with the client",
		async (event, trigger) => {
			await notifySecurityAlert({ event, userId: "user-1", ...client });

			expect(getUserPrimaryOrganizationId).toHaveBeenCalledWith("user-1");
			expect(trigger).toHaveBeenCalledExactlyOnceWith({
				userId: "user-1",
				organizationId: "org-primary",
				...client,
			});
		},
	);

	it("sends nothing for a user without an organization", async () => {
		getUserPrimaryOrganizationId.mockResolvedValue(undefined);

		await notifySecurityAlert({ event: "password_changed", userId: "user-1", ...client });

		expect(onPasswordChanged).not.toHaveBeenCalled();
	});
});
