import { Suspense } from "react";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/enterprise/api-keys?tab=webhooks");
}

export default function WebhooksSettingsPage() {
	return (
		<Suspense fallback={null}>
			<RedirectContent />
		</Suspense>
	);
}
