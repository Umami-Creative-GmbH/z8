import type { SCIMProjectedUserState } from "@better-auth/scim";
import type {
	SCIMLifecycleStateRecord,
	SCIMProviderConfigRecord,
	SCIMTransactionStore,
} from "./transaction-store";

export async function resolveSCIMReconciliationContext(
	input: SCIMProjectedUserState,
	store: SCIMTransactionStore,
): Promise<{
	config: SCIMProviderConfigRecord;
	lifecycle: SCIMLifecycleStateRecord | null;
}> {
	const organizationId = input.provisioningDomainId;
	const config = await store.getActiveProviderConfig(organizationId);
	if (!config) throw new Error("SCIM connection is not active");
	const lifecycle = await store.getLifecycleState(organizationId, input.userId);

	if (input.sources.length === 0) {
		if (input.active || input.grants.length > 0 || !lifecycle) {
			throw new Error("SCIM connection is not active");
		}
		return { config, lifecycle };
	}

	const sourcesBelongToOrganization = input.sources.every(
		(source) => source.provisioningDomainId === organizationId,
	);
	const includesActiveConfig = input.sources.some(
		(source) => source.connectionId === config.connectionId,
	);
	if (!sourcesBelongToOrganization || !includesActiveConfig) {
		throw new Error("SCIM connection is not active");
	}

	return { config, lifecycle };
}
