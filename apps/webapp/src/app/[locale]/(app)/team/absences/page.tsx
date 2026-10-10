import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { isPersonnelFilesEnabled } from "@/lib/personnel-file/access-store";
import { isUuid } from "@/lib/validations/uuid";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";
import { getAbsenceCategories } from "../../absences/queries";
import { getCurrentEmployee } from "../actions";
import { getManagerAbsenceCalendar, getManagerAbsenceEmployees } from "./actions";
import { canUseManagerAbsencePage } from "./manager-absence-permissions";
import { TeamAbsenceYearCalendar } from "./team-absence-year-calendar";
import { TeamAbsencesTable } from "./team-absences-table";

type TeamAbsencesPageProps = {
	searchParams: Promise<{
		search?: string;
		page?: string;
		pageSize?: string;
		year?: string;
		teamId?: string;
		sort?: string;
		direction?: string;
		/** The offboarding checklist's link (#1014): the absences this employee covers… */
		deputy?: string;
		/** …that have not ended at this instant (the departure's cutoff, ISO). */
		coverAt?: string;
	}>;
};

/** The deputy filter of the offboarding link, or undefined when absent or malformed. */
function parseDeputyCover(params: { deputy?: string; coverAt?: string }) {
	if (!isUuid(params.deputy) || !params.coverAt) return undefined;
	try {
		parseInstant(params.coverAt);
	} catch {
		return undefined;
	}
	return { deputyEmployeeId: params.deputy, at: params.coverAt };
}

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function TeamAbsencesPageContent({ searchParams }: TeamAbsencesPageProps) {
	const [t, currentEmployee, params] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
		searchParams,
	]);
	const title = t("team.absences.title", "Team absences");
	const description = t(
		"team.absences.description",
		"Review allowances and record approved absences for your team.",
	);

	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("team.absences.feature", "manage team absences")} />
			</div>
		);
	}

	if (!canUseManagerAbsencePage(currentEmployee.role)) {
		return redirectWithLocale("/");
	}

	const search = (params.search ?? "").trim();
	const selectedYear = parsePositiveInteger(params.year);
	const deputyCover = parseDeputyCover(params);
	const [listResult, calendarResult, categories, sickNotesEnabled] = await Promise.all([
		getManagerAbsenceEmployees({
			search,
			page: parsePositiveInteger(params.page),
			pageSize: parsePositiveInteger(params.pageSize),
			year: selectedYear,
			teamId: params.teamId,
			sort: params.sort,
			direction: params.direction,
		}),
		getManagerAbsenceCalendar({
			year: selectedYear,
			teamId: params.teamId,
			...(deputyCover ? { deputyCover } : {}),
		}),
		getAbsenceCategories(currentEmployee.organizationId),
		// Recorders may add the sick note while personnel files are on (#984).
		isPersonnelFilesEnabled(db, currentEmployee.organizationId),
	]);

	if (!listResult.success) {
		return (
			<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
				<div className="px-4 lg:px-6">
					<h1 className="text-pretty text-2xl font-semibold">{title}</h1>
					<p className="text-muted-foreground">{description}</p>
				</div>
				<div className="px-4 lg:px-6">
					<div className="rounded-lg border bg-card p-6 text-center">
						<h2 className="font-semibold">
							{t("team.absences.error.title", "Unable to load absences")}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{listResult.error ??
								t("team.absences.error.description", "Please try again in a moment.")}
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-pretty text-2xl font-semibold">{title}</h1>
				<p className="text-muted-foreground">{description}</p>
			</div>

			<div className="space-y-6 px-4 lg:px-6">
				{deputyCover && (
					<p className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
						<span>
							{t(
								"team.absences.deputyFilter.notice",
								"Showing only the absences this employee covers as deputy.",
							)}
						</span>
						<Link
							className="underline underline-offset-4"
							href={selectedYear ? `/team/absences?year=${selectedYear}` : "/team/absences"}
						>
							{t("team.absences.deputyFilter.clear", "Show all absences")}
						</Link>
					</p>
				)}
				{calendarResult.success ? (
					<TeamAbsenceYearCalendar data={calendarResult.data} />
				) : (
					<div className="rounded-lg border bg-card p-6 text-center">
						<h2 className="font-semibold">
							{t("team.absences.calendar.error.title", "Unable to load calendar")}
						</h2>
						<p className="mt-1 text-muted-foreground text-sm">
							{calendarResult.error ??
								t("team.absences.calendar.error.description", "Please try again in a moment.")}
						</p>
					</div>
				)}
				<TeamAbsencesTable
					data={listResult.data}
					categories={categories}
					search={search}
					sickNotesEnabled={sickNotesEnabled}
				/>
			</div>
		</div>
	);
}

function TeamAbsencesPageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="space-y-2 px-4 lg:px-6">
				<Skeleton className="h-8 w-44" />
				<Skeleton className="h-5 w-full max-w-2xl" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton className="h-[520px] w-full" />
			</div>
		</div>
	);
}

export default function TeamAbsencesPage(props: TeamAbsencesPageProps) {
	return (
		<Suspense fallback={<TeamAbsencesPageLoading />}>
			<TeamAbsencesPageContent {...props} />
		</Suspense>
	);
}
