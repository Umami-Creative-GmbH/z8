import { IconEdit, IconUser } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/user-avatar";
import { Link } from "@/navigation";
import type { getTranslate } from "@/tolgee/server";

type Translate = Awaited<ReturnType<typeof getTranslate>>;

interface EmployeeAllowance {
	customAnnualDays: string | null;
	customCarryoverDays: string | null;
	adjustmentDays: string | null;
}

interface EmployeeManager {
	id: string;
	isPrimary: boolean;
	manager: {
		user: {
			name: string;
		};
	};
}

interface EmployeeWithAllowance {
	id: string;
	user: {
		name: string;
		email: string;
		image: string | null;
	};
	team: { name: string } | null;
	vacationAllowances: EmployeeAllowance[];
	managers?: EmployeeManager[];
}

interface EmployeePolicyAssignment {
	assignmentType: string;
	employeeId: string | null;
	policy: { name: string } | null;
}

interface EmployeeAllowancesViewProps {
	currentYear: number;
	defaultDays: string;
	employees: EmployeeWithAllowance[];
	hasOrganizationPolicy: boolean;
	policyAssignments: EmployeePolicyAssignment[];
	t: Translate;
}

export function EmployeeAllowancesView({
	currentYear,
	defaultDays,
	employees,
	hasOrganizationPolicy,
	policyAssignments,
	t,
}: EmployeeAllowancesViewProps) {
	const employeePolicyMap = new Map<string, EmployeePolicyAssignment>();
	for (const assignment of policyAssignments) {
		if (assignment.assignmentType === "employee" && assignment.employeeId) {
			employeePolicyMap.set(assignment.employeeId, assignment);
		}
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.vacation.employees.title", "Employee Allowances")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vacation.employees.description",
							"Configure custom vacation allowances for individual employees",
						)}
					</p>
				</div>
			</div>

			<EmployeeAllowancesCard
				currentYear={currentYear}
				defaultDays={defaultDays}
				employees={employees}
				employeePolicyMap={employeePolicyMap}
				hasOrganizationPolicy={hasOrganizationPolicy}
				t={t}
			/>
		</div>
	);
}

interface EmployeeAllowancesCardProps {
	currentYear: number;
	defaultDays: string;
	employees: EmployeeWithAllowance[];
	employeePolicyMap: Map<string, EmployeePolicyAssignment>;
	hasOrganizationPolicy: boolean;
	t: Translate;
}

function EmployeeAllowancesCard({
	currentYear,
	defaultDays,
	employees,
	employeePolicyMap,
	hasOrganizationPolicy,
	t,
}: EmployeeAllowancesCardProps) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center justify-between">
					<div>
						<CardTitle>
							{t(
								"settings.vacation.employees.allowancesForYear",
								"Vacation Allowances for {{year}}",
								{ year: currentYear },
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.vacation.employees.defaultAllowanceDescription",
								"Default allowance: {{days}} days per year",
								{ days: defaultDays },
							)}
							{!hasOrganizationPolicy &&
								t(
									"settings.vacation.employees.noOrgPolicyConfigured",
									" (No org policy configured)",
								)}
						</CardDescription>
					</div>
					<Badge variant="secondary">
						{t(
							"settings.vacation.employees.employeeCount",
							"{{count}} employees",
							{ count: employees.length },
						)}
					</Badge>
				</div>
			</CardHeader>
			<CardContent>
				{employees.length === 0 ? (
					<EmployeeAllowancesEmptyState t={t} />
				) : (
					<EmployeeAllowancesTable
						defaultDays={defaultDays}
						employees={employees}
						employeePolicyMap={employeePolicyMap}
						t={t}
					/>
				)}
			</CardContent>
		</Card>
	);
}

function EmployeeAllowancesEmptyState({ t }: { t: Translate }) {
	return (
		<div className="rounded-lg border border-dashed p-8 text-center">
			<IconUser className="mx-auto size-10 text-muted-foreground" />
			<h3 className="mt-4 text-lg font-semibold">
				{t("settings.vacation.employees.emptyTitle", "No employees found")}
			</h3>
			<p className="mt-2 text-sm text-muted-foreground">
				{t(
					"settings.vacation.employees.emptyDescription",
					"Add employees to your organization to manage their vacation allowances.",
				)}
			</p>
		</div>
	);
}

interface EmployeeAllowancesTableProps {
	defaultDays: string;
	employees: EmployeeWithAllowance[];
	employeePolicyMap: Map<string, EmployeePolicyAssignment>;
	t: Translate;
}

function EmployeeAllowancesTable({
	defaultDays,
	employees,
	employeePolicyMap,
	t,
}: EmployeeAllowancesTableProps) {
	const columns = [
		["settings.vacation.employees.table.employee", "Employee", ""],
		["settings.vacation.employees.table.policy", "Policy", ""],
		["settings.vacation.employees.table.team", "Team", ""],
		["settings.vacation.employees.table.managers", "Managers", ""],
		[
			"settings.vacation.employees.table.defaultDays",
			"Default Days",
			"text-right",
		],
		[
			"settings.vacation.employees.table.customDays",
			"Custom Days",
			"text-right",
		],
		["settings.vacation.employees.table.carryover", "Carryover", "text-right"],
		[
			"settings.vacation.employees.table.adjustments",
			"Adjustments",
			"text-right",
		],
		[
			"settings.vacation.employees.table.totalAvailable",
			"Total Available",
			"text-right",
		],
		["settings.vacation.employees.table.actions", "Actions", "text-right"],
	] as const;

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					<TableRow>
						{columns.map(([key, fallback, className]) => (
							<TableHead key={key} className={className}>
								{t(key, fallback)}
							</TableHead>
						))}
					</TableRow>
				</TableHeader>
				<TableBody>
					{employees.map((employee) => (
						<EmployeeAllowanceRow
							key={employee.id}
							defaultDays={defaultDays}
							employee={employee}
							policyAssignment={employeePolicyMap.get(employee.id)}
							t={t}
						/>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

interface EmployeeAllowanceRowProps {
	defaultDays: string;
	employee: EmployeeWithAllowance;
	policyAssignment?: EmployeePolicyAssignment;
	t: Translate;
}

function EmployeeAllowanceRow({
	defaultDays,
	employee,
	policyAssignment,
	t,
}: EmployeeAllowanceRowProps) {
	const allowance = employee.vacationAllowances[0];
	const customDays = allowance?.customAnnualDays
		? Number.parseFloat(allowance.customAnnualDays)
		: null;
	const annualDays = customDays ?? Number.parseFloat(defaultDays);
	const carryover = allowance?.customCarryoverDays
		? Number.parseFloat(allowance.customCarryoverDays)
		: 0;
	const adjustments = allowance?.adjustmentDays
		? Number.parseFloat(allowance.adjustmentDays)
		: 0;
	const total = annualDays + carryover + adjustments;

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-3">
					<UserAvatar
						image={employee.user.image}
						seed={employee.id}
						name={employee.user.name}
						size="sm"
						clockStatus="unknown"
					/>
					<div>
						<div className="font-medium">{employee.user.name}</div>
						<div className="text-xs text-muted-foreground">
							{employee.user.email}
						</div>
					</div>
				</div>
			</TableCell>
			<TableCell>
				{policyAssignment ? (
					<Badge variant="outline">{policyAssignment.policy?.name}</Badge>
				) : (
					<span className="text-muted-foreground text-sm">
						{t("settings.vacation.employees.defaultPolicy", "Default")}
					</span>
				)}
			</TableCell>
			<TableCell>{employee.team?.name || "—"}</TableCell>
			<TableCell>
				<EmployeeManagers managers={employee.managers} t={t} />
			</TableCell>
			<TableCell className="text-right tabular-nums">
				<span
					className={`text-muted-foreground${customDays === null ? "" : " line-through"}`}
				>
					{defaultDays}
				</span>
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{customDays !== null ? (
					<Badge variant="default">{customDays}</Badge>
				) : (
					<span className="text-muted-foreground">—</span>
				)}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{carryover > 0 ? (
					<span className="text-green-600">+{carryover}</span>
				) : (
					<span className="text-muted-foreground">—</span>
				)}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{adjustments !== 0 ? (
					<span className={adjustments > 0 ? "text-green-600" : "text-red-600"}>
						{adjustments > 0 ? "+" : ""}
						{adjustments}
					</span>
				) : (
					<span className="text-muted-foreground">—</span>
				)}
			</TableCell>
			<TableCell className="text-right font-semibold tabular-nums">
				{total}
			</TableCell>
			<TableCell className="text-right">
				<Button variant="ghost" size="sm" asChild>
					<Link href={`/settings/vacation/employees/${employee.id}`}>
						<IconEdit className="mr-1 size-4" />
						{t("settings.vacation.employees.actions.edit", "Edit")}
					</Link>
				</Button>
			</TableCell>
		</TableRow>
	);
}

function EmployeeManagers({
	managers,
	t,
}: {
	managers?: EmployeeManager[];
	t: Translate;
}) {
	if (!managers || managers.length === 0) {
		return <span className="text-muted-foreground">—</span>;
	}

	return (
		<div className="flex flex-col gap-1">
			{managers.map((manager) => (
				<div key={manager.id} className="flex items-center gap-1">
					<span className="text-sm">{manager.manager.user.name}</span>
					{manager.isPrimary && (
						<Badge variant="secondary" className="text-xs">
							{t("settings.vacation.employees.primaryManager", "Primary")}
						</Badge>
					)}
				</div>
			))}
		</div>
	);
}
