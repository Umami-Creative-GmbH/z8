import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { TeamDetailPageClient } from "./team-detail-page-client";

async function GuardedTeamDetailContent({
	params,
}: {
	params: Promise<{ teamId: string }>;
}) {
	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (
		!settingsRouteContext ||
		settingsRouteContext.accessTier === "member" ||
		!settingsRouteContext.authContext.session.activeOrganizationId
	) {
		return redirectWithLocale("/settings");
	}

	return <TeamDetailPageClient params={params} />;
}

export default function TeamDetailPage({
	params,
}: {
	params: Promise<{ teamId: string }>;
}) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<GuardedTeamDetailContent params={params} />
		</Suspense>
	);
}
