import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import { getAbsenceCategories } from "../../absences/actions";
import { getCurrentEmployee } from "../actions";
import { getManagerAbsenceEmployees } from "./actions";
import { canUseManagerAbsencePage } from "./manager-absence-permissions";
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
	}>;
};

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function TeamAbsencesPageContent({ searchParams }: TeamAbsencesPageProps) {
	await connection();

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
		redirect("/");
	}

	const search = (params.search ?? "").trim();
	const [listResult, categories] = await Promise.all([
		getManagerAbsenceEmployees({
			search,
			page: parsePositiveInteger(params.page),
			pageSize: parsePositiveInteger(params.pageSize),
			year: parsePositiveInteger(params.year),
			teamId: params.teamId,
			sort: params.sort,
			direction: params.direction,
		}),
		getAbsenceCategories(currentEmployee.organizationId),
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

			<div className="px-4 lg:px-6">
				<TeamAbsencesTable data={listResult.data} categories={categories} search={search} />
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
