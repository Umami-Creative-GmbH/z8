import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import { getMyRequests } from "./actions";
import { MyRequestsClient } from "./my-requests-client";

async function MyRequestsPageContent() {
	const [t, result] = await Promise.all([getTranslate(), getMyRequests()]);

	if (!result.success && result.error === "Employee profile not found") {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("myRequests:myRequests.featureName", "view your requests")}
				/>
			</div>
		);
	}

	if (!result.success) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
				<Alert variant="destructive">
					<AlertTitle>
						{t(
							"myRequests:myRequests.unavailableTitle",
							"Requests unavailable",
						)}
					</AlertTitle>
					<AlertDescription>{result.error}</AlertDescription>
				</Alert>
			</div>
		);
	}

	return <MyRequestsClient initialResult={result.data} />;
}

function MyRequestsPageLoading() {
	return (
		<div
			aria-label="Loading your requests"
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
			role="status"
		>
			<header className="space-y-3 px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
			</header>
			<section className="grid gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6">
				{["pending", "fixes", "decisions", "total"].map((key) => (
					<Skeleton aria-hidden="true" className="h-28 w-full" key={key} />
				))}
			</section>
			<section className="px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-80 w-full" />
			</section>
		</div>
	);
}

export default function MyRequestsPage() {
	return (
		<Suspense fallback={<MyRequestsPageLoading />}>
			<MyRequestsPageContent />
		</Suspense>
	);
}
