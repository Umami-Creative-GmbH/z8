import { describe, expect, it } from "vitest";
import {
	canAccessOrganizationWithSso,
	type SessionSsoStore,
} from "./session-sso";

const session = { id: "session-1", userId: "user-1" };
const proof = {
	sessionId: session.id,
	userId: session.userId,
	organizationId: "org-1",
	providerId: "idp-1",
};

function store(overrides: Partial<SessionSsoStore> = {}): SessionSsoStore {
	return {
		getPolicy: async () => ({ required: true, providerId: "idp-1" }),
		getProvenance: async () => proof,
		saveProvenance: async () => {},
		...overrides,
	};
}

describe("organization SSO session authorization", () => {
	it("accepts only verified proof for the exact session, user, organization and provider", async () => {
		expect(await canAccessOrganizationWithSso(store(), session, "org-1")).toBe(
			true,
		);
		for (const mismatch of [
			{ sessionId: "other-session" },
			{ userId: "other-user" },
			{ organizationId: "other-org" },
			{ providerId: "other-provider" },
		]) {
			expect(
				await canAccessOrganizationWithSso(
					store({ getProvenance: async () => ({ ...proof, ...mismatch }) }),
					session,
					"org-1",
				),
			).toBe(false);
		}
	});

	it("requires old, credential, social and unproven sessions to reauthenticate", async () => {
		expect(
			await canAccessOrganizationWithSso(
				store({ getProvenance: async () => null }),
				session,
				"org-1",
			),
		).toBe(false);
		expect(await canAccessOrganizationWithSso(store(), null, "org-1")).toBe(
			false,
		);
	});

	it("keeps organizations without an enabled requirement usable without proof", async () => {
		expect(
			await canAccessOrganizationWithSso(
				store({
					getPolicy: async () => ({ required: false, providerId: null }),
					getProvenance: async () => {
						throw new Error("unnecessary proof lookup");
					},
				}),
				session,
				"org-1",
			),
		).toBe(true);
	});

	it("fails closed when a required provider is missing or the policy store fails", async () => {
		expect(
			await canAccessOrganizationWithSso(
				store({
					getPolicy: async () => ({ required: true, providerId: null }),
				}),
				session,
				"org-1",
			),
		).toBe(false);
		await expect(
			canAccessOrganizationWithSso(
				store({
					getPolicy: async () => {
						throw new Error("database unavailable");
					},
				}),
				session,
				"org-1",
			),
		).rejects.toThrow("database unavailable");
	});
});
