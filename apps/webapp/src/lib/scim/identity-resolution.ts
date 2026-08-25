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
	const externalId = input.resource.externalId;
	if (!externalId?.trim()) {
		throw new APIError("CONFLICT", SCIM_IDENTITY_CONFLICT);
	}

	const store = createSCIMReadStore(context.database);
	const userIds = await store.findUserIdsByProviderSubject(
		input.provisioningDomainId,
		externalId,
	);
	if (userIds.length === 1) {
		const userId = userIds[0];
		const member = await store.findOrganizationMember(
			userId,
			input.provisioningDomainId,
		);
		if (member) {
			return { action: "link", userId, profile: "preserve" };
		}
	}

	throw new APIError("CONFLICT", SCIM_IDENTITY_CONFLICT);
}
