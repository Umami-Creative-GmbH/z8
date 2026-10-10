/**
 * Serializable views of the accounting connection and a customer's accounting
 * side (#903), returned by the Billable Time server actions. Client-safe. They
 * never carry the API key.
 */

import type { AccountingProviderCapabilities, AccountingProviderKind } from "./provider";
import { formatTaxRate, type TaxTreatment, type TaxTreatmentKind } from "./tax-treatment";

/** A tax treatment for forms: kind and the rate as a two-decimal percentage. */
export interface TaxTreatmentView {
	kind: TaxTreatmentKind;
	rate: string;
}

export function taxTreatmentView(treatment: TaxTreatment): TaxTreatmentView {
	return { kind: treatment.kind, rate: formatTaxRate(treatment.rateBasisPoints) };
}

export interface AccountingConnectionView {
	id: string;
	providerKind: AccountingProviderKind;
	accountLabel: string | null;
	defaultTaxTreatment: TaxTreatmentView;
	/** ISO instant. */
	connectedAt: string;
	connectedByName: string | null;
	/** False when the secret store lost the key: the connection must be replaced. */
	apiKeyStored: boolean;
	/** False when this deployment has no connector for the tool. */
	providerAvailable: boolean;
	capabilities: AccountingProviderCapabilities | null;
}

export interface ContactLinkView {
	contactId: string;
	contactName: string;
	contactNumber: string | null;
}

export interface CustomerAccountingView {
	customerId: string;
	name: string;
	isActive: boolean;
	contactLink: ContactLinkView | null;
	/** The customer's own treatment, or null when the connection default applies. */
	taxOverride: TaxTreatmentView | null;
}

/** The tool's product name (a proper noun, not translated). */
export function accountingProviderName(kind: AccountingProviderKind): string {
	switch (kind) {
		case "lexware_office":
			return "Lexware Office";
		case "sevdesk":
			return "sevdesk";
	}
}

export interface AccountingProviderOption {
	kind: AccountingProviderKind;
	/** Whether a connector for the tool exists in this deployment. */
	available: boolean;
	capabilities: AccountingProviderCapabilities | null;
}
