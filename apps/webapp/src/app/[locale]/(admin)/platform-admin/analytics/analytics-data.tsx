import { randomUUID } from "node:crypto";
import { isAccountBanned } from "@/lib/auth/account-ban";
import { getRequestSession } from "@/lib/auth/request-session";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getPlatformAnalyticsData } from "@/lib/platform-analytics/service";
import type {
	ParsedPlatformAnalyticsParams,
	PlatformAnalyticsData,
} from "@/lib/platform-analytics/types";
import { PlatformAnalyticsCharts } from "./analytics-charts";
import { AnalyticsReadFailure } from "./analytics-read-failure";
import { AnalyticsSnapshot } from "./analytics-snapshot";

export async function PlatformAnalyticsDataSection({
	parsedParams,
}: {
	parsedParams: ParsedPlatformAnalyticsParams;
}) {
	// Layout and page work can run concurrently. Admit before starting any global read.
	const session = await getRequestSession();
	if (!session?.user) return redirectWithLocale("/sign-in");
	if (session.user.role !== "admin" || isAccountBanned(session.user))
		return redirectWithLocale("/");
	const sessionId = session.session?.id;
	if (!sessionId) return redirectWithLocale("/sign-in");
	let data: PlatformAnalyticsData | null;
	try {
		data = await getPlatformAnalyticsData(parsedParams);
	} catch {
		data = null;
	}
	return (
		<AnalyticsSnapshot userId={session.user.id} sessionId={sessionId} readId={randomUUID()}>
			{data ? <PlatformAnalyticsCharts data={data} /> : <AnalyticsReadFailure />}
		</AnalyticsSnapshot>
	);
}
