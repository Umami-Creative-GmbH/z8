import { Suspense } from "react";
import { MyDataPanel } from "@/components/settings/my-data/my-data-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getMyDataOverview } from "./actions";

async function MyDataPageContent() {
	await requireUser();
	const [t, overview] = await Promise.all([getTranslate(), getMyDataOverview()]);
	const state = overview.success ? overview.data : { status: "unavailable" as const };

	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div>
					<h1 className="text-2xl font-semibold">{t("settings.myData.title", "My data")}</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.myData.description",
							"Download a copy of the personal data this organization keeps about you",
						)}
					</p>
				</div>
				{state.status === "available" ? (
					<MyDataPanel exports={state.exports} />
				) : state.status === "no_employee_record" ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.myData.noEmployeeRecord",
							"You have no employee record in this organization. To get a copy of the personal data it keeps about you, contact the organization's admins.",
						)}
					</p>
				) : (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.myData.unavailable",
							"My data is not available for your account in this organization.",
						)}
					</p>
				)}
			</div>
		</div>
	);
}

function MyDataPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto min-w-0 max-w-3xl space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-40" />
					<Skeleton className="h-5 w-full max-w-xl" />
				</div>
				<Skeleton className="h-56 w-full" />
			</div>
		</div>
	);
}

export default function MyDataPage() {
	return (
		<Suspense fallback={<MyDataPageLoading />}>
			<MyDataPageContent />
		</Suspense>
	);
}
