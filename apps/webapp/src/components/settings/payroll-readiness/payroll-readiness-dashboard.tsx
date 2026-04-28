import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
	PayrollReadinessCheck,
	PayrollReadinessResult,
} from "@/lib/payroll-readiness/get-payroll-readiness";
import { Link } from "@/navigation";

type TranslateFn = (
	key: string,
	defaultValue?: string,
	params?: Record<string, string | number>,
) => string;

type DashboardCheck = PayrollReadinessCheck & {
	actionLabel?: string;
};

type DashboardAffectedEmployee = PayrollReadinessCheck["affectedEmployees"][number] & {
	employeeNumber?: string | null;
};

interface PayrollReadinessDashboardProps {
	t: TranslateFn;
	data: PayrollReadinessResult;
}

export function PayrollReadinessDashboard({ t, data }: PayrollReadinessDashboardProps) {
	const checks = getChecks(data);

	return (
		<div className="space-y-6">
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
				<SummaryCard
					title={t("settings.payrollReadiness.summary.status", "Status")}
					value={
						<Badge variant={data.status === "blocked" ? "destructive" : "secondary"}>
							{getReadinessStatusLabel(data.status, t)}
						</Badge>
					}
					description={t("settings.payrollReadiness.summary.statusDescription", "Overall payroll export readiness.")}
				/>
				<SummaryCard
					title={t("settings.payrollReadiness.summary.period", "Period")}
					value={data.period.label}
					description={t("settings.payrollReadiness.summary.periodDescription", "Payroll period being verified.")}
				/>
				<SummaryCard
					title={t("settings.payrollReadiness.summary.blockers", "Blockers")}
					value={String(data.summary.blockerCount)}
					description={t("settings.payrollReadiness.summary.blockersDescription", "Required checks currently blocking export.")}
				/>
				<SummaryCard
					title={t("settings.payrollReadiness.summary.warnings", "Warnings")}
					value={String(data.summary.warningCount)}
					description={t("settings.payrollReadiness.summary.warningsDescription", "Non-blocking issues to review before export.")}
				/>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<SummaryCard
					title={t("settings.payrollReadiness.summary.exportTargets", "Configured export targets")}
					value={String(data.summary.configuredExportTargetCount)}
					description={t("settings.payrollReadiness.summary.exportTargetsDescription", "Active payroll export destinations.")}
				/>
				<SummaryCard
					title={t("settings.payrollReadiness.summary.affectedEmployees", "Affected employees")}
					value={String(data.summary.affectedEmployeeCount)}
					description={t("settings.payrollReadiness.summary.affectedEmployeesDescription", "Employees linked to open readiness items.")}
				/>
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				{checks.map((check) => (
					<ChecklistCard key={check.id} t={t} check={check} />
				))}
			</div>
		</div>
	);
}

function SummaryCard({
	title,
	value,
	description,
}: {
	title: string;
	value: ReactNode;
	description: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardDescription>{description}</CardDescription>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<div className="text-2xl font-semibold tracking-tight">{value}</div>
			</CardContent>
		</Card>
	);
}

function ChecklistCard({ t, check }: { t: TranslateFn; check: DashboardCheck }) {
	const actionLabel = check.actionLabel ?? getActionLabel(check.actionHref, t);

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-1">
						<CardTitle>
							<h2 className="text-base font-semibold">{check.title}</h2>
						</CardTitle>
						<CardDescription>{check.description}</CardDescription>
					</div>
					<Badge variant={check.status === "fail" ? "destructive" : "secondary"}>
						{getCheckStatusLabel(check.status, t)}
					</Badge>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap items-center gap-3 text-sm">
					<span className="text-muted-foreground">{t("settings.payrollReadiness.checks.count", "Count")}</span>
					<span className="font-medium">{check.count}</span>
					{check.actionHref && actionLabel ? (
						<Link className={actionLinkClassName} href={check.actionHref}>
							{actionLabel}
						</Link>
					) : null}
				</div>

				{check.affectedEmployees?.length ? (
					<AffectedEmployeesTable
						t={t}
						employees={check.affectedEmployees as DashboardAffectedEmployee[]}
					/>
				) : null}
			</CardContent>
		</Card>
	);
}

function AffectedEmployeesTable({
	t,
	employees,
}: {
	t: TranslateFn;
	employees: DashboardAffectedEmployee[];
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>{t("settings.payrollReadiness.affectedEmployees.name", "Employee")}</TableHead>
					<TableHead>{t("settings.payrollReadiness.affectedEmployees.number", "Employee number")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{employees.map((employee) => (
					<TableRow key={employee.id}>
						<TableCell>
							<div className="min-w-0 space-y-1">
								<p className="font-medium">{employee.name ?? employee.email ?? employee.id}</p>
								{employee.email ? (
									<p className="text-muted-foreground text-sm break-words">{employee.email}</p>
								) : null}
							</div>
						</TableCell>
						<TableCell>
							{employee.employeeNumber ?? t("settings.payrollReadiness.affectedEmployees.noNumber", "Not set")}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

const actionLinkClassName =
	"rounded-sm font-medium underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function getChecks(data: PayrollReadinessResult): DashboardCheck[] {
	return ((data as PayrollReadinessResult & { checks?: DashboardCheck[] }).checks
		?? data.groups.flatMap((group) => group.checks)) as DashboardCheck[];
}

function getReadinessStatusLabel(status: PayrollReadinessResult["status"], t: TranslateFn) {
	switch (status) {
		case "ready":
			return t("settings.payrollReadiness.status.ready", "Ready for payroll");
		case "blocked":
			return t("settings.payrollReadiness.status.blocked", "Blocked");
		case "unavailable":
			return t("settings.payrollReadiness.status.unavailable", "Unable to verify");
	}
}

function getCheckStatusLabel(status: PayrollReadinessCheck["status"], t: TranslateFn) {
	switch (status) {
		case "pass":
			return t("settings.payrollReadiness.checkStatus.pass", "Ready");
		case "warning":
			return t("settings.payrollReadiness.checkStatus.warning", "Warning");
		case "fail":
			return t("settings.payrollReadiness.checkStatus.fail", "Blocked");
		case "unavailable":
			return t("settings.payrollReadiness.checkStatus.unavailable", "Unable to verify");
	}
}

function getActionLabel(href: string | undefined, t: TranslateFn) {
	switch (href) {
		case "/approvals/inbox":
			return t("settings.payrollReadiness.actions.approvals", "Review approval inbox");
		case "/time-tracking":
			return t("settings.payrollReadiness.actions.timeTracking", "Review time tracking");
		case "/settings/payroll-export":
			return t("settings.payrollReadiness.actions.payrollExport", "Open payroll export settings");
		case "/travel-expenses/approvals":
			return t("settings.payrollReadiness.actions.travelExpenses", "Review travel expenses");
		default:
			return undefined;
	}
}
