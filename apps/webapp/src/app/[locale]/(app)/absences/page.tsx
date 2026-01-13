import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AbsencesViewContainer } from "@/components/absences/absences-view-container";
import { RequestAbsenceDialog } from "@/components/absences/request-absence-dialog";
import { VacationBalanceCard } from "@/components/absences/vacation-balance-card";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth";
import { getTranslate } from "@/tolgee/server";
import {
	getAbsenceCategories,
	getAbsenceEntries,
	getCurrentEmployee,
	getHolidays,
	getVacationBalance,
} from "./actions";

export default async function AbsencesPage() {
	const t = await getTranslate();
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const employee = await getCurrentEmployee();
	if (!employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("absences.featureName", "manage absences")} />
			</div>
		);
	}

	const currentYear = new Date().getFullYear();

	// Fetch full year data for the year calendar view
	const startOfYear = `${currentYear}-01-01`;
	const endOfYear = `${currentYear}-12-31`;
	const yearStart = new Date(currentYear, 0, 1);
	const yearEnd = new Date(currentYear, 11, 31);

	// Fetch all data in parallel
	const [vacationBalance, absences, holidays, categories] = await Promise.all([
		getVacationBalance(employee.id, currentYear),
		getAbsenceEntries(employee.id, startOfYear, endOfYear),
		getHolidays(employee.organizationId, yearStart, yearEnd),
		getAbsenceCategories(employee.organizationId),
	]);

	// If no vacation allowance is set up, show message
	if (!vacationBalance) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<div className="text-center">
					<h2 className="text-2xl font-semibold mb-2">{t("absences.errors.allowanceNotConfigured", "Vacation Allowance Not Configured")}</h2>
					<p className="text-muted-foreground">
						{t("absences.errors.allowanceNotConfiguredMessage", "Your organization hasn't set up vacation allowances for {currentYear} yet.", { currentYear })}
						<br />
						{t("absences.errors.contactAdmin", "Please contact your administrator to configure vacation policies.")}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Header with Vacation Balance */}
			<div className="px-4 lg:px-6">
				<div className="flex items-center justify-between mb-4">
					<div>
						<h1 className="text-2xl font-semibold">{t("absences.title", "Absences")}</h1>
						<p className="text-muted-foreground">{t("absences.subtitle", "Manage your time off and vacation days")}</p>
					</div>
					<RequestAbsenceDialog
						categories={categories}
						remainingDays={vacationBalance.remainingDays}
						trigger={<Button>{t("absences.requestAbsence", "Request Absence")}</Button>}
					/>
				</div>
				<VacationBalanceCard balance={vacationBalance} />
			</div>

			{/* Calendar/Table View Container with Toggle */}
			<div className="px-4 lg:px-6">
				<AbsencesViewContainer
					absences={absences}
					holidays={holidays}
					categories={categories}
					remainingDays={vacationBalance.remainingDays}
					currentYear={currentYear}
				/>
			</div>
		</div>
	);
}
