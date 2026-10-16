import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function EmailTemplatesSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/enterprise/email?tab=templates");
}
function EmailTemplatesSettingsPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<Skeleton className="h-8 w-56" />
			<Skeleton className="h-64 w-full" />
		</div>
	);
}

export default function EmailTemplatesSettingsPage() {
	return (
		<Suspense fallback={<EmailTemplatesSettingsPageLoading />}>
			<EmailTemplatesSettingsPageContent />
		</Suspense>
	);
}
