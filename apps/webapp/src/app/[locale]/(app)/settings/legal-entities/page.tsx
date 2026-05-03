import { LegalEntitiesManagement } from "@/components/settings/legal-entities/legal-entities-management";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getLegalEntities } from "./actions";

export default async function LegalEntitiesPage() {
	await requireOrgAdminSettingsAccess();
	const entities = await getLegalEntities();

	return <LegalEntitiesManagement entities={entities} />;
}
