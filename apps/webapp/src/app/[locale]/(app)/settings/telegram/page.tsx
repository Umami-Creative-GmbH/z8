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
		<div className="p-6">
			<div className="mx-auto max-w-3xl space-y-4">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-5 w-96" />
				<Skeleton className="h-[380px] w-full" />
			</div>
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
