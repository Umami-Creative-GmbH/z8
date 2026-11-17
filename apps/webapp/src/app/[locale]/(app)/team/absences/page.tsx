import { unstable_rethrow } from "next/navigation";
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
import { TeamAbsencesHeading, TeamAbsencesWorkspace } from "./team-absences-workspace";

type TeamAbsencesPageProps = {
	searchParams: Promise<{
		search?: string;
		page?: string;
		pageSize?: string;
		year?: string;
		teamId?: string;
		sort?: string;
		direction?: string;
		/** The offboarding link: absences this employee covers as deputy. */
		deputy?: string;
		/** Only absences that have not ended at the departure cutoff (ISO). */
		coverAt?: string;
	}>;
};

async function recoverRead<T>(read: Promise<T>, failure: T): Promise<T> {
	try {
		return await read;
	} catch (error) {
		unstable_rethrow(error);
		return failure;
	}
}

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
				<div>
					<h1 className="mb-4 text-2xl font-semibold">{title}</h1>
					<NoEmployeeError feature={t("team.absences.feature", "manage team absences")} />
				</div>
			</div>
		);
	}

	if (!canUseManagerAbsencePage(currentEmployee.role)) {
		return redirectWithLocale("/");
	}

	const search = (params.search ?? "").trim();
	const selectedYear = parsePositiveInteger(params.year);
	const deputyCover = parseDeputyCover(params);
	const [listResult, calendarResult, categoriesResult, sickNotesResult] = await Promise.all([
		recoverRead(
			getManagerAbsenceEmployees({
				search,
				page: parsePositiveInteger(params.page),
				pageSize: parsePositiveInteger(params.pageSize),
				year: selectedYear,
				teamId: params.teamId,
				sort: params.sort,
				direction: params.direction,
			}),
			{ success: false, error: "Unable to load absences" },
		),
		recoverRead(
			getManagerAbsenceCalendar({
				year: selectedYear,
				teamId: params.teamId,
				...(deputyCover ? { deputyCover } : {}),
			}),
			{ success: false, error: "Unable to load calendar" },
		),
		recoverRead(
			getAbsenceCategories(currentEmployee.organizationId).then((data) => ({
				success: true,
				data,
			})),
			{ success: false, data: [] },
		),
		// Recorders may add the sick note while personnel files are on (#984).
		recoverRead(
			isPersonnelFilesEnabled(db, currentEmployee.organizationId).then((data) => ({
				success: true,
				data,
			})),
			{ success: false, data: false },
		),
	]);

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
				<TeamAbsencesWorkspace
					actor={{
						userId: currentEmployee.userId,
						organizationId: currentEmployee.organizationId,
						employeeId: currentEmployee.id,
						role: currentEmployee.role,
					}}
					requestKey={JSON.stringify(params)}
					listResult={listResult}
					calendarResult={calendarResult}
					categories={categoriesResult.data}
					search={search}
					sickNotesEnabled={sickNotesResult.data}
					recordingSetupUnavailable={!categoriesResult.success || !sickNotesResult.success}
				/>
			</div>
		</div>
	);
}

function TeamAbsencesPageLoading() {
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="space-y-2 px-4 lg:px-6">
				<TeamAbsencesHeading />
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
