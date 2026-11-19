import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { PageHeader } from "@/components/ui/page-header";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee, getManagedEmployees } from "./actions";
import { TeamDirectoryRecords } from "./team-directory-records";

export async function TeamDirectory({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const [t, currentEmployee, params] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
		searchParams,
	]);
	const title = t("team.title", "Your Team");
	if (!currentEmployee) {
		return (
			<div className="@container/main page-frame flex flex-1 flex-col gap-6">
				<PageHeader title={title} />
				<NoEmployeeError feature={t("team.feature", "view your team")} />
			</div>
		);
	}
	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		return redirectWithLocale("/");
	}
	const showFormer = params.former === "1";
	const result = await getManagedEmployees({ includeFormer: showFormer });
	return (
		<TeamDirectoryRecords
			key={`${currentEmployee.organizationId}:${currentEmployee.userId}:${currentEmployee.id}`}
			scope={{
				organizationId: currentEmployee.organizationId,
				userId: currentEmployee.userId,
				employeeId: currentEmployee.id,
			}}
			result={result}
			showFormer={showFormer}
		/>
	);
}
