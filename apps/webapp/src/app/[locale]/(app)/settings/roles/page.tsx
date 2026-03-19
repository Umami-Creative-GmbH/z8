import { connection } from "next/server";
import { CustomRolesManagement } from "@/components/settings/custom-roles/custom-roles-management";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

export default async function CustomRolesSettingsPage() {
	await connection();

	const { organizationId } = await requireOrgAdminSettingsAccess();

	return <CustomRolesManagement organizationId={organizationId} />;
}
