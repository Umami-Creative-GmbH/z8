import type { CreateCustomerInput } from "@/app/[locale]/(app)/settings/customers/actions";
import type { SettingsAccessTier } from "@/lib/settings-access";

export interface CustomerDialogFormValues {
	projectId: string;
	name: string;
	address: string;
	vatId: string;
	email: string;
	contactPerson: string;
	phone: string;
	website: string;
}

export function requiresScopedProjectSelection(
	accessTier: SettingsAccessTier,
	isEditing: boolean,
) {
	return accessTier === "manager" && !isEditing;
}

export function buildCreateCustomerInput(
	organizationId: string,
	value: CustomerDialogFormValues,
): CreateCustomerInput {
	return {
		organizationId,
		projectId: value.projectId || undefined,
		name: value.name,
		address: value.address || undefined,
		vatId: value.vatId || undefined,
		email: value.email || undefined,
		contactPerson: value.contactPerson || undefined,
		phone: value.phone || undefined,
		website: value.website || undefined,
	};
}
