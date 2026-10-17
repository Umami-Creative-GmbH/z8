import { Suspense } from "react";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/audit-export?tab=activity");
}

export default function AuditLogPage() {
	return (
		<Suspense fallback={null}>
			<RedirectContent />
		</Suspense>
	);
}
