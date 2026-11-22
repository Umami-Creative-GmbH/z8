import { Suspense } from "react";
import { SettingsContentLoading } from "@/components/shells/settings-content-loading";
import { getCurrentSettingsAccess } from "@/lib/auth-helpers";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { meetsSettingsAccess } from "@/lib/organization-action/settings-access-level";
import { TeamDetailPageClient } from "./team-detail-page-client";

async function GuardedTeamDetailContent({ params }: { params: Promise<{ teamId: string }> }) {
	const caller = await getCurrentSettingsAccess();

	if (!caller?.settingsAccess || !meetsSettingsAccess(caller.settingsAccess, "scopedManager")) {
		return redirectWithLocale("/settings");
	}

	return <TeamDetailPageClient params={params} />;
}

export default function TeamDetailPage({ params }: { params: Promise<{ teamId: string }> }) {
	return (
		<Suspense fallback={<SettingsContentLoading />}>
			<GuardedTeamDetailContent params={params} />
		</Suspense>
	);
}
