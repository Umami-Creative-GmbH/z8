import type { AccountingConnector, AccountingProviderKind } from "./provider";

/**
 * Accounting connectors by provider kind (#903). The connection store, contact
 * picker and hand-off look a connection's connector up here.
 */
export interface AccountingProviderRegistry {
	get(kind: AccountingProviderKind): AccountingConnector | null;
	/** Kinds an admin can connect now, in registration order. */
	availableKinds(): AccountingProviderKind[];
}

export function createAccountingProviderRegistry(
	connectors: readonly AccountingConnector[],
): AccountingProviderRegistry {
	const byKind = new Map<AccountingProviderKind, AccountingConnector>();
	for (const connector of connectors) {
		if (byKind.has(connector.kind)) {
			throw new Error(`Two accounting connectors for ${connector.kind}`);
		}
		byKind.set(connector.kind, connector);
	}
	return {
		get: (kind) => byKind.get(kind) ?? null,
		availableKinds: () => [...byKind.keys()],
	};
}

/**
 * The production connectors. #904 adds the Lexware Office connector and #905
 * the sevdesk connector here; until then no kind can be connected. Tests
 * replace `getAccountingProviderRegistry` with `fakeAccountingProviderRegistry`
 * (`vi.mock("@/lib/billable-time/accounting/registry", ...)`).
 */
const PRODUCTION_CONNECTORS: readonly AccountingConnector[] = [];

let productionRegistry: AccountingProviderRegistry | null = null;

export function getAccountingProviderRegistry(): AccountingProviderRegistry {
	productionRegistry ??= createAccountingProviderRegistry(PRODUCTION_CONNECTORS);
	return productionRegistry;
}
