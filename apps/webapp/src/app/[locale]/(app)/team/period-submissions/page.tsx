import { Suspense } from "react";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { PeriodSubmissionOverview } from "./period-submission-overview";
import { getPeriodSubmissionOverview } from "./period-submissions-data";

type PeriodSubmissionsPageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function requestedPeriod(params: Record<string, string | string[] | undefined>): string | null {
	const value = params.period;
	return typeof value === "string" ? value : null;
}

/**
 * Period submissions (#1063): who has submitted the selected submission period. Owners and admins
 * see every covered employee, managers the employees they manage. Read-only.
 */
async function PeriodSubmissionsContent({ searchParams }: PeriodSubmissionsPageProps) {
	const [t, params] = await Promise.all([getTranslate(), searchParams]);
	const result = await getPeriodSubmissionOverview(requestedPeriod(params));
	if (result.status === "forbidden") {
		return redirectWithLocale("/");
	}
	const { overview, scope } = result;

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<header className="space-y-2 px-4 lg:px-6">
				<h1 className="text-pretty text-2xl font-semibold">
					{t("team.periodSubmissions.title", "Period submissions")}
				</h1>
				<p className="max-w-prose text-muted-foreground">
					{scope === "all"
						? t(
								"team.periodSubmissions.descriptionAll",
								"Who has submitted the selected period. Approve or reject submissions in the approval inbox.",
							)
						: t(
								"team.periodSubmissions.descriptionManaged",
								"Who of the employees you manage has submitted the selected period. Approve or reject submissions in the approval inbox.",
							)}{" "}
					<Link href="/approvals/inbox" className="underline underline-offset-4">
						{t("team.periodSubmissions.openInbox", "Open the approval inbox")}
					</Link>
				</p>
			</header>
			<div className="px-4 lg:px-6">
				{overview.kind === "off" ? (
					<div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
						<p>
							{t(
								"team.periodSubmissions.off",
								"Your organization does not collect period submissions.",
							)}
						</p>
						{scope === "all" ? (
							<Link
								href="/settings/organizations"
								className="mt-2 inline-block underline underline-offset-4"
							>
								{t(
									"team.periodSubmissions.chooseCadence",
									"Choose a submission cadence in the organization settings",
								)}
							</Link>
						) : null}
					</div>
				) : (
					<PeriodSubmissionOverview
						periods={overview.periods}
						selected={overview.selected}
						running={overview.running}
						rows={overview.rows}
						counts={overview.counts}
					/>
				)}
			</div>
		</div>
	);
}

function PeriodSubmissionsLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "team.periodSubmissions.loading",
				labelDefault: "Loading period submissions",
			}}
			className="@container/main flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-56" />
			<Skeleton aria-hidden="true" className="h-10 w-full max-w-xs" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function PeriodSubmissionsPage(props: PeriodSubmissionsPageProps) {
	return (
		<Suspense fallback={<PeriodSubmissionsLoading />}>
			<PeriodSubmissionsContent {...props} />
		</Suspense>
	);
}
