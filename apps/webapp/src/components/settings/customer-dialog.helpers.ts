import type { CreateCustomerInput } from "@/app/[locale]/(app)/settings/customers/actions";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";

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

export function requiresScopedProjectSelection(settingsAccess: SettingsAccess, isEditing: boolean) {
	return !meetsSettingsAccess(settingsAccess, "orgAdmin") && !isEditing;
}

export function buildCreateCustomerInput(value: CustomerDialogFormValues): CreateCustomerInput {
	return {
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
