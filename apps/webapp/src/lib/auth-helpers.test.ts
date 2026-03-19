import { describe, expect, it } from "vitest";
import { mapSessionUserToAuthContextUser } from "./auth/auth-context-user";

describe("mapSessionUserToAuthContextUser", () => {
	it("exposes trimmed first and last names while preserving the existing name", () => {
		expect(
			mapSessionUserToAuthContextUser({
				id: "user_123",
				email: "ada@example.com",
				name: "Ada Lovelace",
				firstName: "  Ada ",
				lastName: " Lovelace  ",
				canCreateOrganizations: true,
				canUseWebapp: true,
				canUseDesktop: false,
				canUseMobile: true,
			}),
		).toMatchObject({
			id: "user_123",
			email: "ada@example.com",
			name: "Ada Lovelace",
			firstName: "Ada",
			lastName: "Lovelace",
			canCreateOrganizations: true,
			canUseWebapp: true,
			canUseDesktop: false,
			canUseMobile: true,
		});
	});

	it("drops blank structured names and keeps compatibility defaults", () => {
		expect(
			mapSessionUserToAuthContextUser({
				id: "user_456",
				email: "grace@example.com",
				name: "Grace Hopper",
				firstName: "  ",
				lastName: undefined,
			}),
		).toMatchObject({
			name: "Grace Hopper",
			firstName: undefined,
			lastName: undefined,
			canCreateOrganizations: false,
			canUseWebapp: true,
			canUseDesktop: true,
			canUseMobile: true,
		});
	});
});
