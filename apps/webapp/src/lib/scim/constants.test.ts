import { describe, expect, it } from "vitest";
import { getSCIMCredentialExpiresAt, SCIM_SCOPES } from "./constants";

describe("SCIM constants", () => {
	it("contains every SCIM operation scope", () => {
		expect(SCIM_SCOPES).toEqual([
			"scim.users.read",
			"scim.users.write",
			"scim.groups.read",
			"scim.groups.write",
		]);
	});

	it("sets credential expiry to a fixed 365-day instant duration", () => {
		const now = new Date("2024-03-01T12:30:00.000Z");

		expect(getSCIMCredentialExpiresAt(now)).toEqual(
			new Date("2025-03-01T12:30:00.000Z"),
		);
	});
});
