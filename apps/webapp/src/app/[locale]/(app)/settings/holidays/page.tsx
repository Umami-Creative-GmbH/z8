import { HolidayManagement } from "@/components/settings/holiday-management";
import { requireAuth } from "@/lib/auth-helpers";

export default async function HolidaySettingsPage() {
	const authContext = await requireAuth();

	return <HolidayManagement organizationId={authContext.employee.organizationId} />;
}
