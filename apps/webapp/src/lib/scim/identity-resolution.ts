import type {
	SCIMIdentityResolution,
	SCIMIdentityResolutionContext,
	SCIMIdentityResolutionInput,
} from "@better-auth/scim";
import { APIError } from "better-auth/api";
import { createSCIMReadStore } from "./transaction-store";

const SCIM_IDENTITY_CONFLICT = {
	schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
	status: "409",
	detail: "The SCIM identity cannot be linked",
} as const;

export async function resolveSCIMIdentity(
	input: SCIMIdentityResolutionInput,
	context: SCIMIdentityResolutionContext,
): Promise<SCIMIdentityResolution> {
	const store = createSCIMReadStore(context.database);
	const email = input.resource.primaryEmail.trim().toLowerCase();
	const user = await store.findUserByEmail(email);

	if (!user) {
		return { action: "create" };
	}

	if (user.emailVerified) {
		const member = await store.findOrganizationMember(
			user.id,
			input.provisioningDomainId,
		);
		if (member) {
			return { action: "link", userId: user.id, profile: "preserve" };
		}
	}

	throw new APIError("CONFLICT", SCIM_IDENTITY_CONFLICT);
}
