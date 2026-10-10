import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ApiKeyDetailView } from "@/components/enterprise/api-key-detail-view";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getApiKeyDetail } from "../actions";

interface ApiKeyDetailPageProps {
	params: Promise<{ keyId: string }>;
}

async function ApiKeyDetailPageContent({ params }: ApiKeyDetailPageProps) {
	const [{ keyId }, { organizationId }] = await Promise.all([
		params,
		requireOrgAdminSettingsAccess(),
	]);
	const result = await getApiKeyDetail(organizationId, keyId);
	if (!result.success) notFound();
	return <ApiKeyDetailView detail={result.data} />;
}

function ApiKeyDetailPageLoading() {
	return (
		<div className="p-4 sm:p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-[320px] w-full" />
			</div>
		</div>
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
