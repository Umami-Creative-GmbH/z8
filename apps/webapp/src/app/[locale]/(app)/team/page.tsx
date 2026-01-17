import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Badge } from "@/components/ui/badge";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee, getManagedEmployees } from "./actions";
import { TeamMembersList } from "./team-members-list";

export default async function TeamPage() {
	// Parallelize independent async operations to eliminate waterfall
	const [t, currentEmployee] = await Promise.all([getTranslate(), getCurrentEmployee()]);

	// Show error if no employee profile found
	if (!currentEmployee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("team.feature", "view your team")} />
			</div>
		);
	}

	// Only managers and admins can access this page
	if (currentEmployee.role !== "manager" && currentEmployee.role !== "admin") {
		redirect("/");
	}

	const result = await getManagedEmployees();

	// Handle error case
	if (!result.success) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<div className="text-center">
					<h2 className="text-lg font-semibold">{t("team.error.title", "Something went wrong")}</h2>
					<p className="text-sm text-muted-foreground">
						{t("team.error.description", "Unable to load your team members.")}
					</p>
				</div>
			</div>
		);
	}

	const employees = result.data;

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Page Header */}
			<div className="flex items-center justify-between px-4 lg:px-6">
				<div>
					<h1 className="text-3xl font-bold tracking-tight">{t("team.title", "Your Team")}</h1>
					<p className="text-muted-foreground">
						{t("team.description", "View and manage employees you directly supervise")}
					</p>
				</div>
				{employees.length > 0 && (
					<Badge variant="secondary" className="text-sm">
						{employees.length}{" "}
						{employees.length === 1 ? t("team.member", "member") : t("team.members", "members")}
					</Badge>
				)}
			</div>

			{/* Team Members List */}
			<div className="px-4 lg:px-6">
				<TeamMembersList employees={employees} />
			</div>
		</div>
	);
}
