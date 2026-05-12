import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
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
	}>;
};

function parsePositiveInteger(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);

	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export default async function TeamAbsencesPage({ searchParams }: TeamAbsencesPageProps) {
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
						<h2 className="font-semibold">{t("team.absences.error.title", "Unable to load absences")}</h2>
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
