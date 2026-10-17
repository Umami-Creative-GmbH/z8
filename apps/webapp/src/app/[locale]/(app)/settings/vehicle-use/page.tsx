import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

async function VehicleUseSettingsPageContent() {
	await requireOrgAdminSettingsAccess();
	return redirectWithLocale("/settings/vehicles?tab=use");
}

function VehicleUseSettingsPageLoading() {
	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="min-w-0 space-y-4">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function VehicleUseSettingsPage() {
	return (
		<Suspense fallback={<VehicleUseSettingsPageLoading />}>
			<VehicleUseSettingsPageContent />
		</Suspense>
	);
}
