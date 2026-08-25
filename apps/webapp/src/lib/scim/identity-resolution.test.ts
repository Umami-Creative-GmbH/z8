import type {
	SCIMIdentityResolutionContext,
	SCIMIdentityResolutionInput,
} from "@better-auth/scim";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { resolveSCIMIdentity } from "./identity-resolution";

const TARGET_ORGANIZATION_ID = "organization_target";

function resolutionInput(
	externalId: string | undefined,
	primaryEmail = "user@example.com",
): SCIMIdentityResolutionInput {
	return {
		connectionId: "connection_1",
		provisioningDomainId: TARGET_ORGANIZATION_ID,
		resource: {
			primaryEmail,
			...(externalId === undefined ? {} : { externalId }),
		} as SCIMIdentityResolutionInput["resource"],
	};
}

function resolutionContext(
	findOne: ReturnType<typeof vi.fn>,
	findMany: ReturnType<typeof vi.fn>,
): SCIMIdentityResolutionContext {
	return {
		database: {
			findOne,
			findMany,
		} as SCIMIdentityResolutionContext["database"],
	};
}

async function expectSafeConflict(promise: Promise<unknown>) {
	const error = await promise.catch((caught: unknown) => caught);

	expect(error).toBeInstanceOf(APIError);
	expect(error).toMatchObject({ status: "CONFLICT" });
	expect(error.body).toEqual({
		schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
		status: "409",
		detail: "The SCIM identity cannot be linked",
	});
	expect(JSON.stringify(error)).not.toContain("user@example.com");
	expect(JSON.stringify(error)).not.toContain("subject_foreign");
	expect(JSON.stringify(error)).not.toContain("organization_foreign");
}

describe("resolveSCIMIdentity", () => {
	it("links the user with the exact externalId on an active persisted provider in the target organization", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ id: "member_1" });
		const findMany = vi.fn().mockResolvedValueOnce([{ userId: "user_1" }]);

		await expect(
			resolveSCIMIdentity(
				resolutionInput("subject_target"),
				resolutionContext(findOne, findMany),
			),
		).resolves.toEqual({
			action: "link",
			userId: "user_1",
			profile: "preserve",
		});
	});

	it("rejects an unbound externalId instead of creating a user from the SCIM email", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" });
		const findMany = vi.fn().mockResolvedValueOnce([]);

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("subject_unbound", "existing@example.com"),
				resolutionContext(findOne, findMany),
			),
		);
		expect(findOne).toHaveBeenCalledTimes(2);
	});

	it("rejects a missing externalId without using the SCIM email as an identity", async () => {
		const findOne = vi.fn();
		const findMany = vi.fn();

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput(undefined),
				resolutionContext(findOne, findMany),
			),
		);
		expect(findOne).not.toHaveBeenCalled();
		expect(findMany).not.toHaveBeenCalled();
	});

	it("rejects an exact subject bound only to a provider in another organization", async () => {
		const findOne = vi.fn().mockResolvedValue(null);
		const findMany = vi.fn();

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("subject_foreign"),
				resolutionContext(findOne, findMany),
			),
		);
		expect(findOne).toHaveBeenCalledExactlyOnceWith({
			model: "enterpriseIdentitySetup",
			select: ["providerId"],
			where: [{ field: "organizationId", value: TARGET_ORGANIZATION_ID }],
		});
	});

	it("rejects a verified provider whose domain differs from the enterprise setup", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "target.example" })
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "foreign.example" });
		const findMany = vi.fn();

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("subject_target"),
				resolutionContext(findOne, findMany),
			),
		);
		expect(findMany).not.toHaveBeenCalled();
	});

	it("rejects ambiguous provider subject bindings", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" });
		const findMany = vi
			.fn()
			.mockResolvedValueOnce([{ userId: "user_1" }, { userId: "user_2" }]);

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("subject_ambiguous"),
				resolutionContext(findOne, findMany),
			),
		);
		expect(findOne).toHaveBeenCalledTimes(2);
	});

	it("rejects a duplicate persisted binding even when it names the same user", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ id: "member_1" });
		const findMany = vi
			.fn()
			.mockResolvedValueOnce([{ userId: "user_1" }, { userId: "user_1" }]);

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("subject_duplicate"),
				resolutionContext(findOne, findMany),
			),
		);
	});

	it("queries only active target-organization providers and exact validated subjects", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "example.com" })
			.mockResolvedValueOnce({ providerId: "provider_target", domain: "EXAMPLE.COM" })
			.mockResolvedValueOnce({ id: "member_1" });
		const findMany = vi.fn().mockResolvedValueOnce([{ userId: "user_1" }]);

		await resolveSCIMIdentity(
			resolutionInput("subject_target", "untrusted@example.com"),
			resolutionContext(findOne, findMany),
		);

		expect(findOne).toHaveBeenNthCalledWith(1, {
			model: "enterpriseIdentitySetup",
			select: ["providerId", "domain"],
			where: [{ field: "organizationId", value: TARGET_ORGANIZATION_ID }],
		});
		expect(findOne).toHaveBeenNthCalledWith(2, {
			model: "ssoProvider",
			select: ["providerId", "domain"],
			where: [
				{ field: "providerId", value: "provider_target" },
				{ field: "organizationId", value: TARGET_ORGANIZATION_ID },
				{ field: "domainVerified", value: true },
			],
		});
		expect(findMany).toHaveBeenNthCalledWith(1, {
			model: "account",
			select: ["userId"],
			where: [
				{ field: "providerId", value: "provider_target" },
				{ field: "accountId", value: "subject_target" },
			],
		});
		expect(findOne).toHaveBeenCalledWith({
			model: "member",
			select: ["id"],
			where: [
				{ field: "userId", value: "user_1" },
				{ field: "organizationId", value: TARGET_ORGANIZATION_ID },
			],
		});
		expect(JSON.stringify(findMany.mock.calls)).not.toContain(
			"untrusted@example.com",
		);
	});
});
