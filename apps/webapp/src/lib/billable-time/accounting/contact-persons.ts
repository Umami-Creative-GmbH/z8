import "server-only";

import type { AccountingDependencies } from "./connection-store";
import {
	type AccountingContactPerson,
	AccountingProviderError,
	isAccountingProviderKind,
} from "./provider";

export type ListContactPersonsOutcome =
	| { ok: true; persons: AccountingContactPerson[] }
	| { ok: false; reason: "invalid_provider" | "provider_unavailable" | "invalid_api_key" }
	| { ok: false; reason: "credentials_refused" }
	| { ok: false; reason: "tool_unreachable"; message: string };

/**
 * The users of the tool account behind a not-yet-stored API key, for the
 * connection form's contact person choice (sevdesk, #905). The key is used for
 * this one request and not kept. Tools without contact persons answer `[]`.
 */
export async function listAccountingContactPersons(
	dependencies: Pick<AccountingDependencies, "registry">,
	input: { providerKind: unknown; apiKey: unknown },
): Promise<ListContactPersonsOutcome> {
	if (!isAccountingProviderKind(input.providerKind)) {
		return { ok: false, reason: "invalid_provider" };
	}
	const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
	if (apiKey === "") return { ok: false, reason: "invalid_api_key" };
	const connector = dependencies.registry.get(input.providerKind);
	if (!connector) return { ok: false, reason: "provider_unavailable" };
	if (!connector.listContactPersons) return { ok: true, persons: [] };
	try {
		return { ok: true, persons: await connector.listContactPersons({ apiKey }) };
	} catch (error) {
		if (error instanceof AccountingProviderError) {
			return error.failure === "unauthorized"
				? { ok: false, reason: "credentials_refused" }
				: { ok: false, reason: "tool_unreachable", message: error.message };
		}
		throw error;
	}
}
