import { Suspense } from "react";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/notification-channels?tab=teams");
}

export default function LegacyChatSettingsPage() {
	return (
		<Suspense fallback={null}>
			<RedirectContent />
		</Suspense>
	);
}
