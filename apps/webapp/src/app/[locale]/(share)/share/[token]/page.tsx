import { IconLinkOff } from "@tabler/icons-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { SharedReportView } from "@/components/reports/projects/shared-report-view";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { openShareLink } from "@/lib/projects/report-share/report-share-links";
import { getClientIp } from "@/lib/rate-limit";
import { getTranslate } from "@/tolgee/server";

export const metadata: Metadata = {
	title: "Shared report | Z8",
	referrer: "no-referrer",
	robots: { index: false, follow: false, nocache: true },
};

interface SharePageProps {
	params: Promise<{ locale: string; token: string }>;
}

export default function SharePage(props: SharePageProps) {
	return (
		<Suspense fallback={<SharePageLoading />}>
			<SharePageContent {...props} />
		</Suspense>
	);
}

function SharePageLoading() {
	return (
		<LoadingRegion
			aria-busy="true"
			label={{ labelKey: "reports.share.page.loading", labelDefault: "Loading shared report" }}
			className="mx-auto w-full max-w-5xl space-y-6 px-4 py-10"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-64" />
			<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

async function SharePageContent({ params }: SharePageProps) {
	const { locale, token } = await params;
	await connection();
	const requestHeaders = await headers();
	const ipAddress = getClientIp(new Request("http://localhost", { headers: requestHeaders }));
	const opened = await openShareLink(db, {
		token,
		now: systemClock.nowInstant(),
		request: {
			ipAddress: ipAddress === "unknown" ? null : ipAddress,
			userAgent: requestHeaders.get("user-agent"),
		},
	});

	if (opened.status === "unavailable") {
		const t = await getTranslate();
		return (
			<main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10">
				<section
					aria-labelledby="share-unavailable-title"
					className="space-y-3 rounded-xl border p-6"
				>
					<IconLinkOff aria-hidden="true" className="size-6 text-muted-foreground" />
					<h1 id="share-unavailable-title" className="text-xl font-semibold text-balance">
						{t("reports.share.page.unavailableTitle", "This link isn't available")}
					</h1>
					<p className="text-sm text-muted-foreground text-pretty">
						{t(
							"reports.share.page.unavailableDescription",
							"The link may have expired or been revoked, or it may be incomplete. Ask the person who shared it with you for a new link.",
						)}
					</p>
				</section>
			</main>
		);
	}

	return (
		<SharedReportView
			locale={locale}
			organizationName={opened.organizationName}
			organizationTimeZone={opened.organizationTimeZone}
			creatorName={opened.creatorName}
			createdAt={opened.createdAt}
			expiresAt={opened.expiresAt}
			snapshot={opened.snapshot}
		/>
	);
}
