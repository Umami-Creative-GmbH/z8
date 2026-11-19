import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function TelegramSettingsContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/notification-channels?tab=telegram");
}
function TelegramSettingsLoading() {
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-5 w-96" />
			<Skeleton className="h-[380px] w-full" />
		</div>
	);
}

export default function TelegramSettingsPage() {
	return (
		<Suspense fallback={<TelegramSettingsLoading />}>
			<TelegramSettingsContent />
		</Suspense>
	);
}
