import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { MY_REQUESTS_FOCUS_PARAM } from "@/lib/time-tracking/period-submissions/blocker-navigation";
import { getTranslate } from "@/tolgee/server";
import { getMyRequests } from "./actions";
import { MyRequestsClient } from "./my-requests-client";

interface MyRequestsPageProps {
	searchParams: Promise<{ [MY_REQUESTS_FOCUS_PARAM]?: string | string[] }>;
}

async function MyRequestsPageContent({ searchParams }: MyRequestsPageProps) {
	const [t, result, params] = await Promise.all([getTranslate(), getMyRequests(), searchParams]);
	const focusRequest = params[MY_REQUESTS_FOCUS_PARAM];

	if (!result.success && result.error === "Employee profile not found") {
		return (
			<div className="@container/main page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={t("myRequests:myRequests.title", "My Requests")} />
				<NoEmployeeError feature={t("myRequests:myRequests.featureName", "view your requests")} />
			</div>
		);
	}

	if (!result.success) {
		return (
			<div className="@container/main page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={t("myRequests:myRequests.title", "My Requests")} />
				<Alert variant="destructive">
					<AlertTitle>
						{t("myRequests:myRequests.unavailableTitle", "Requests unavailable")}
					</AlertTitle>
					<AlertDescription>{result.error}</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<MyRequestsClient
			initialResult={result.data}
			focusRequest={typeof focusRequest === "string" ? focusRequest : undefined}
		/>
	);
}

async function MyRequestsPageLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			label={{
				labelKey: "common.loadingRegions.yourRequests",
				labelDefault: "Loading your requests",
			}}
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
		>
			<PageHeader title={t("myRequests:myRequests.title", "My Requests")} />
			<div>
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
			</div>
			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				{["pending", "fixes", "decisions", "total"].map((key) => (
					<Skeleton aria-hidden="true" className="h-28 w-full" key={key} />
				))}
			</section>
			<section>
				<Skeleton aria-hidden="true" className="h-80 w-full" />
			</section>
		</LoadingRegion>
	);
}

export default function MyRequestsPage(props: MyRequestsPageProps) {
	return (
		<Suspense fallback={<MyRequestsPageLoading />}>
			<MyRequestsPageContent {...props} />
		</Suspense>
	);
}
