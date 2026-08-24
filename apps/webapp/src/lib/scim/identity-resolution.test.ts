import type {
	SCIMIdentityResolutionContext,
	SCIMIdentityResolutionInput,
} from "@better-auth/scim";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { resolveSCIMIdentity } from "./identity-resolution";

const TARGET_ORGANIZATION_ID = "organization_target";

function resolutionInput(primaryEmail: string): SCIMIdentityResolutionInput {
	return {
		connectionId: "connection_1",
		provisioningDomainId: TARGET_ORGANIZATION_ID,
		resource: { primaryEmail } as SCIMIdentityResolutionInput["resource"],
	};
}

function resolutionContext(
	findOne: ReturnType<typeof vi.fn>,
): SCIMIdentityResolutionContext {
	return {
		database: { findOne } as SCIMIdentityResolutionContext["database"],
	};
}

async function expectSafeConflict(promise: Promise<unknown>) {
	const error = await promise.catch((caught: unknown) => caught);

	expect(error).toBeInstanceOf(APIError);
	expect(error).toMatchObject({
		status: "CONFLICT",
		body: {
			code: "SCIM_IDENTITY_CONFLICT",
			message: "The SCIM identity cannot be linked",
		},
	});
	expect(JSON.stringify(error)).not.toContain("user@example.com");
	expect(JSON.stringify(error)).not.toContain("organization_foreign");
}

describe("resolveSCIMIdentity", () => {
	it("creates an identity when no user has the primary email", async () => {
		const findOne = vi.fn().mockResolvedValue(null);

		await expect(
			resolveSCIMIdentity(
				resolutionInput("new@example.com"),
				resolutionContext(findOne),
			),
		).resolves.toEqual({ action: "create" });
		expect(findOne).toHaveBeenCalledTimes(1);
	});

	it("links a verified user who is a member of the exact target organization", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ id: "user_1", emailVerified: true })
			.mockResolvedValueOnce({
				id: "member_1",
				userId: "user_1",
				organizationId: TARGET_ORGANIZATION_ID,
			});

		await expect(
			resolveSCIMIdentity(
				resolutionInput("user@example.com"),
				resolutionContext(findOne),
			),
		).resolves.toEqual({
			action: "link",
			userId: "user_1",
			profile: "preserve",
		});
	});

	it("rejects an unverified user without probing organization membership", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValue({ id: "user_1", emailVerified: false });

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("user@example.com"),
				resolutionContext(findOne),
			),
		);
		expect(findOne).toHaveBeenCalledTimes(1);
	});

	it("rejects an absent target-organization membership", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ id: "user_1", emailVerified: true })
			.mockResolvedValueOnce(null);

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("user@example.com"),
				resolutionContext(findOne),
			),
		);
	});

	it("rejects a user whose membership belongs to another organization", async () => {
		const foreignMember = {
			id: "member_foreign",
			userId: "user_1",
			organizationId: "organization_foreign",
		};
		const findOne = vi.fn(async (query: { model: string }) => {
			if (query.model === "user") {
				return { id: "user_1", emailVerified: true };
			}

			// The foreign row exists, but an exact target-org lookup cannot return it.
			return foreignMember.organizationId === TARGET_ORGANIZATION_ID
				? foreignMember
				: null;
		});

		await expectSafeConflict(
			resolveSCIMIdentity(
				resolutionInput("user@example.com"),
				resolutionContext(findOne),
			),
		);
	});

	it("normalizes the email and queries only exact target membership fields", async () => {
		const findOne = vi
			.fn()
			.mockResolvedValueOnce({ id: "user_1", emailVerified: true })
			.mockResolvedValueOnce({ id: "member_1" });

		await resolveSCIMIdentity(
			resolutionInput("  User@Example.COM  "),
			resolutionContext(findOne),
		);

		expect(findOne).toHaveBeenNthCalledWith(1, {
			model: "user",
			where: [
				{
					field: "email",
					value: "user@example.com",
					mode: "insensitive",
				},
			],
		});
		expect(findOne).toHaveBeenNthCalledWith(2, {
			model: "member",
			where: [
				{ field: "userId", value: "user_1" },
				{ field: "organizationId", value: TARGET_ORGANIZATION_ID },
			],
		});
	});
});
