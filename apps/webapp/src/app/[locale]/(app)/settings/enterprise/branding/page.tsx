import { Suspense } from "react";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function RedirectContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/enterprise/domains?tab=branding");
}

export default function BrandingPage() {
	return (
		<Suspense fallback={null}>
			<RedirectContent />
		</Suspense>
	);
}
