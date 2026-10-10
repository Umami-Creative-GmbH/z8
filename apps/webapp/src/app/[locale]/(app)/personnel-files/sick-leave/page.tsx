import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { SickLeaveOverview } from "@/components/personnel-file/sick-leave-overview";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import { managesCategory } from "@/lib/personnel-file/access";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
import { parseSickLeaveOverviewParams } from "@/lib/personnel-file/sick-leave-overview";
import {
	listSickLeaveFilterOptions,
	listSickLeaveOverview,
} from "@/lib/personnel-file/sick-leave-overview-store";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

type SickLeavePageProps = {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Sick leave (#985): the sick-leave absences of the employees whose sick
 * notes the viewer manages, with their linked sick notes, so officers see
 * which certificates are still missing. Strictly passive. Not found without a
 * grant covering sick notes and while personnel files are off. The range is
 * read in the organization's calendar.
 */
async function SickLeaveContent({ searchParams }: SickLeavePageProps) {
	const [t, current, params] = await Promise.all([
		getTranslate(),
		loadCurrentPersonnelFileAccess(),
		searchParams,
	]);
	if (current.status !== "resolved" || !managesCategory(current.access, "sick_note")) notFound();
	const { access } = current;
	const { today } = await loadOrganizationDay(db, {
		organizationId: access.organizationId,
		now: systemClock.nowInstant(),
	});
	const filters = parseSickLeaveOverviewParams(params, today);
	const defaults = parseSickLeaveOverviewParams({}, today);
	const [result, options] = await Promise.all([
		listSickLeaveOverview(db, access, filters),
		listSickLeaveFilterOptions(db, access),
	]);
	if (result.kind !== "ok") notFound();

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Button asChild variant="ghost" size="sm" className="-ml-2">
					<Link href="/personnel-files">
						<IconArrowLeft aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.area.title", "Personnel Files")}
					</Link>
				</Button>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.personnelFiles.sickLeave.title", "Sick leave")}
				</h1>
				<p className="max-w-prose text-muted-foreground">
					{t(
						"settings.personnelFiles.sickLeave.description",
						"Sick-leave absences of the employees whose sick notes you manage, with the sick notes attached to them. Nothing here reminds or asks employees.",
					)}
				</p>
			</header>
			<SickLeaveOverview
				filters={{ ...filters, page: result.page }}
				defaultRange={{ from: defaults.from, to: defaults.to }}
				rows={result.rows}
				total={result.total}
				page={result.page}
				pageCount={result.pageCount}
				employees={options.employees}
				teams={options.teams}
			/>
		</div>
	);
}

function SickLeaveLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.sickLeave.loading",
				labelDefault: "Loading sick leave",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-24 w-full" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function SickLeavePage(props: SickLeavePageProps) {
	return (
		<Suspense fallback={<SickLeaveLoading />}>
			<SickLeaveContent {...props} />
		</Suspense>
	);
}
