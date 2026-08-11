import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { TeamDetailPageClient } from "./team-detail-page-client";

export default function TeamDetailPage({
	params,
}: {
	params: Promise<{ teamId: string }>;
}) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<TeamDetailPageClient params={params} />
		</Suspense>
	);
}
