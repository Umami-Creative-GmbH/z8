import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ApiKeyDetailView } from "@/components/enterprise/api-key-detail-view";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getApiKeyDetail } from "../actions";

interface ApiKeyDetailPageProps {
	params: Promise<{ keyId: string }>;
}

async function ApiKeyDetailPageContent({ params }: ApiKeyDetailPageProps) {
	const [{ keyId }] = await Promise.all([params, requireOrgAdminSettingsAccess()]);
	const result = await getApiKeyDetail({ keyId });
	if (!result.success) notFound();
	return <ApiKeyDetailView detail={result.data} />;
}

function ApiKeyDetailPageLoading() {
	return (
		<LoadingRegion
			className="page-frame"
			label={{ labelKey: "settings.apiKeys.detail.loading", labelDefault: "Loading API key" }}
		>
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton aria-hidden="true" className="h-8 w-32" />
					<Skeleton aria-hidden="true" className="h-9 w-56 max-w-full" />
					<Skeleton aria-hidden="true" className="h-5 w-40 max-w-full" />
				</div>
				<Skeleton aria-hidden="true" className="h-40 w-full rounded-xl" />
				<Skeleton aria-hidden="true" className="h-[320px] w-full rounded-xl" />
			</div>
		</LoadingRegion>
	);
}

/** One API key with its recent requests from the key request log (#763). Org admins only. */
export default function ApiKeyDetailPage({ params }: ApiKeyDetailPageProps) {
	return (
		<Suspense fallback={<ApiKeyDetailPageLoading />}>
			<ApiKeyDetailPageContent params={params} />
		</Suspense>
	);
}
