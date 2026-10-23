"use client";

import {
	IconBuilding,
	IconLoader2,
	IconPlus,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { EmployeeSingleSelect } from "@/components/employee-select";
import { FormerEmployeeBadge } from "@/components/former-employees/former-employee-ui";
import { toSelectableEmployee } from "@/components/settings/access-grants/grant-editor";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
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
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";

type AssignmentScope = "organization" | "team" | "employee";
export type FeatureAssignmentTarget =
	| { type: "organization" }
	| { type: "team"; teamId: string }
	| { type: "employee"; employeeId: string };

interface FeatureAssignment<Value extends string> {
	id: string;
	assignmentType: AssignmentScope;
	teamId: string | null;
	employeeId: string | null;
	value: Value;
}
interface ScopedFeatureAssignmentsProps<Value extends string> {
	assignments: FeatureAssignment<Value>[];
	teams: { id: string; name: string }[];
	/**
	 * A former employee (#1438) is listed only to name an existing row; never
	 * offered. `formerSince` is the date they left, null when not recorded (#1439).
	 */
	employees: { id: string; name: string; isFormer?: boolean; formerSince?: string | null }[];
	options: { value: Value; label: string }[];
	valueLabel: string;
	organizationLabel: string;
	description: string;
	onSave: (target: FeatureAssignmentTarget, value: Value) => Promise<boolean>;
	onRemove: (assignmentId: string) => Promise<boolean>;
}

export function FeatureSettingsTabs({
	settings,
	assignments,
}: {
	settings: ReactNode;
	assignments: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<Tabs defaultValue="settings" className="space-y-4">
			<TabsList>
				<TabsTrigger value="settings">
					{t("nav.settings", "Settings")}
				</TabsTrigger>
				<TabsTrigger value="assignments">
					{t("settings.workPolicies.tab.assignments", "Assignments")}
				</TabsTrigger>
			</TabsList>
			<TabsContent value="settings" className="space-y-4" keepMounted>
				{settings}
			</TabsContent>
			<TabsContent value="assignments" className="space-y-4">
				{assignments}
			</TabsContent>
		</Tabs>
	);
}

export function ScopedFeatureAssignments<Value extends string>({
	assignments,
	teams,
	employees,
	options,
	valueLabel,
	organizationLabel,
	description,
	onSave,
	onRemove,
}: ScopedFeatureAssignmentsProps<Value>) {
	const { t } = useTranslate();
	const [scope, setScope] = useState<AssignmentScope>("organization");
	const [panelOpen, setPanelOpen] = useState(false);
	const [pending, setPending] = useState(false);
	const sections = assignmentSections(t);
	const runChange = (change: () => Promise<boolean>) => {
		setPending(true);
		return change()
			.catch(() => {
				toast.error(
					t(
						"settings.featureAssignments.failed",
						"The assignment could not be updated. Try again.",
					),
				);
				return false;
			})
			.finally(() => setPending(false));
	};
	const form = useForm({
		defaultValues: { targetId: "", value: String(options[0].value) },
		onSubmit: async ({ value }) => {
			if (
				pending ||
				!panelOpen ||
				(scope !== "organization" && !value.targetId)
			)
				return;
			const selected = options.find((option) => option.value === value.value);
			if (!selected) return;
			const target: FeatureAssignmentTarget =
				scope === "organization"
					? { type: scope }
					: scope === "team"
						? { type: scope, teamId: value.targetId }
						: { type: scope, employeeId: value.targetId };
			if (await runChange(() => onSave(target, selected.value)))
				setPanelOpen(false);
		},
	});
	const targetId = useStore(form.store, (state) => state.values.targetId);
	const openPanel = (nextScope: AssignmentScope) => {
		form.reset();
		setScope(nextScope);
		setPanelOpen(true);
	};
	const assignedTeamIds = new Set(
		assignments.flatMap((assignment) =>
			assignment.assignmentType === "team" && assignment.teamId
				? [assignment.teamId]
				: [],
		),
	);
	const availableTeams = teams.filter((team) => !assignedTeamIds.has(team.id));
	const assignedEmployeeIds = assignments.flatMap((assignment) =>
		assignment.assignmentType === "employee" && assignment.employeeId
			? [assignment.employeeId]
			: [],
	);
	// Use the already-authorized active employees, including for admins without an employee record.
	// The preloaded picker path does not apply excludeIds, so exclude assigned employees here.
	const assignedEmployeeIdSet = new Set(assignedEmployeeIds);
	const availableEmployees = employees
		.filter((employee) => !employee.isFormer && !assignedEmployeeIdSet.has(employee.id))
		.map((employee) =>
			toSelectableEmployee({ ...employee, email: "" }, { isActive: true }),
		);
	const currentSection = sections.find((section) => section.type === scope);

	return (
		<>
			<p className="text-sm text-muted-foreground">{description}</p>
			<FeatureAssignmentSections
				assignments={assignments}
				teams={teams}
				employees={employees}
				options={options}
				valueLabel={valueLabel}
				organizationLabel={organizationLabel}
				pending={pending}
				remainingTargets={{
					team: availableTeams.length,
					employee: availableEmployees.length,
				}}
				onAdd={openPanel}
				onSave={(target, value) => runChange(() => onSave(target, value))}
				onRemove={(id) => runChange(() => onRemove(id))}
			/>
			<ActionPanel
				open={panelOpen}
				onOpenChange={(open) => {
					if (!open && !pending) setPanelOpen(false);
				}}
			>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>{currentSection?.add}</ActionPanelTitle>
						<ActionPanelDescription>
							{currentSection?.description}
						</ActionPanelDescription>
					</ActionPanelHeader>
					{/* TanStack Form submits client-side through the existing server actions. */}
					{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
					<form
						className="flex min-h-0 flex-1 flex-col"
						onSubmit={(event) => {
							event.preventDefault();
							void form.handleSubmit();
						}}
					>
						<ActionPanelBody className="space-y-4">
							{scope === "team" ? (
								<form.Field name="targetId">
									{(field) => (
										<TFormItem>
											<TFormLabel>
												{t("settings.workPolicies.team", "Team")}
											</TFormLabel>
											<Select
												value={field.state.value || null}
												items={availableTeams.map((team) => ({
													value: team.id,
													label: team.name,
												}))}
												disabled={pending}
												onValueChange={(value: string | null) =>
													field.handleChange(value ?? "")
												}
											>
												<TFormControl>
													<SelectTrigger
														className="w-full"
														onBlur={field.handleBlur}
													>
														<SelectValue
															placeholder={t(
																"settings.workPolicies.selectTeam",
																"Select a team",
															)}
														/>
													</SelectTrigger>
												</TFormControl>
												<SelectContent>
													{availableTeams.map((team) => (
														<SelectItem key={team.id} value={team.id}>
															{team.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</TFormItem>
									)}
								</form.Field>
							) : null}
							{scope === "employee" ? (
								<form.Field name="targetId">
									{(field) => (
										<EmployeeSingleSelect
											value={field.state.value || null}
											onChange={(value) => field.handleChange(value ?? "")}
											label={t("settings.workPolicies.employee", "Employee")}
											employees={availableEmployees}
											disabled={pending}
										/>
									)}
								</form.Field>
							) : null}
							<form.Field name="value">
								{(field) => (
									<TFormItem>
										<TFormLabel>{valueLabel}</TFormLabel>
										<Select
											value={field.state.value}
											items={options}
											disabled={pending}
											onValueChange={(value: Value | null) => {
												if (value) field.handleChange(value);
											}}
										>
											<TFormControl>
												<SelectTrigger
													className="w-full"
													onBlur={field.handleBlur}
												>
													<SelectValue />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												{options.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</TFormItem>
								)}
							</form.Field>
						</ActionPanelBody>
						<ActionPanelFooter>
							<Button
								type="button"
								variant="outline"
								disabled={pending}
								onClick={() => setPanelOpen(false)}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button
								type="submit"
								disabled={pending || (scope !== "organization" && !targetId)}
							>
								{pending ? (
									<IconLoader2
										className="mr-2 size-4 animate-spin"
										aria-hidden="true"
									/>
								) : null}
								{t("common.save", "Save")}
							</Button>
						</ActionPanelFooter>
					</form>
				</ActionPanelContent>
			</ActionPanel>
		</>
	);
}

function assignmentSections(t: ReturnType<typeof useTranslate>["t"]) {
	return [
		{
			type: "organization",
			icon: IconBuilding,
			title: t("settings.workPolicies.orgLevel", "Organization Default"),
			description: t(
				"settings.featureAssignments.orgDescription",
				"Default setting for all employees unless overridden",
			),
			add: t("settings.workPolicies.assignOrg", "Set Organization Default"),
			empty: t(
				"settings.workPolicies.noOrgAssignment",
				"No organization default set",
			),
		},
		{
			type: "team",
			icon: IconUsers,
			title: t("settings.workPolicies.teamLevel", "Team Overrides"),
			description: t(
				"settings.workPolicies.teamLevelDescription",
				"Override the organization default for specific teams",
			),
			add: t("settings.workPolicies.addTeam", "Add Team"),
			empty: t(
				"settings.featureAssignments.noTeams",
				"No team-specific settings",
			),
		},
		{
			type: "employee",
			icon: IconUser,
			title: t("settings.workPolicies.employeeLevel", "Employee Overrides"),
			description: t(
				"settings.featureAssignments.employeeDescription",
				"Override the team or organization default for specific employees",
			),
			add: t("settings.workPolicies.addEmployee", "Add Employee"),
			empty: t(
				"settings.featureAssignments.noEmployees",
				"No employee-specific settings",
			),
		},
	] satisfies {
		type: AssignmentScope;
		icon: typeof IconBuilding;
		title: string;
		description: string;
		add: string;
		empty: string;
	}[];
}

type FeatureAssignmentSectionsProps<Value extends string> = Pick<
	ScopedFeatureAssignmentsProps<Value>,
	| "assignments"
	| "teams"
	| "employees"
	| "options"
	| "valueLabel"
	| "organizationLabel"
	| "onSave"
	| "onRemove"
> & {
	pending: boolean;
	remainingTargets: { team: number; employee: number };
	onAdd: (scope: AssignmentScope) => void;
};
function FeatureAssignmentSections<Value extends string>({
	assignments,
	teams,
	employees,
	options,
	valueLabel,
	organizationLabel,
	onSave,
	onRemove,
	pending,
	remainingTargets,
	onAdd,
}: FeatureAssignmentSectionsProps<Value>) {
	const { t } = useTranslate();
	const sections = assignmentSections(t);
	const teamNames = new Map(teams.map((team) => [team.id, team.name]));
	const employeeNames = new Map(
		employees.map((employee) => [employee.id, employee.name]),
	);
	const formerEmployees = new Map(
		employees
			.filter((employee) => employee.isFormer)
			.map((employee) => [employee.id, { since: employee.formerSince }]),
	);
	const optionLabels = new Map(
		options.map((option) => [option.value, option.label]),
	);
	return (
		<>
			{" "}
			{sections.map((section) => {
				const rows = assignments.filter(
					(assignment) => assignment.assignmentType === section.type,
				);
				const Icon = section.icon;
				return (
					<Card key={section.type}>
						<CardHeader>
							<div className="flex flex-wrap items-center justify-between gap-4">
								<div className="flex items-center gap-2">
									<Icon
										className="size-5 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
									<div>
										<CardTitle className="text-base">
											{section.title}
											{section.type !== "organization" && rows.length > 0 ? (
												<Badge variant="secondary" className="ml-2">
													{rows.length}
												</Badge>
											) : null}
										</CardTitle>
										<CardDescription>{section.description}</CardDescription>
									</div>
								</div>
								{section.type !== "organization" ? (
									<Button
										type="button"
										size="sm"
										variant="outline"
										disabled={
											pending ||
											(section.type === "team"
												? remainingTargets.team === 0
												: remainingTargets.employee === 0)
										}
										onClick={() => onAdd(section.type)}
									>
										<IconPlus className="mr-2 size-4" aria-hidden="true" />
										{section.add}
									</Button>
								) : null}
							</div>
						</CardHeader>
						<CardContent>
							{rows.length === 0 ? (
								section.type === "organization" ? (
									<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
										<p className="text-sm text-muted-foreground">
											{section.empty}
										</p>
										<Button
											type="button"
											size="sm"
											variant="outline"
											disabled={pending}
											onClick={() => onAdd(section.type)}
										>
											<IconPlus className="mr-2 size-4" aria-hidden="true" />
											{section.add}
										</Button>
									</div>
								) : (
									<p className="py-4 text-center text-sm text-muted-foreground">
										{section.empty}
									</p>
								)
							) : (
								<ul className="space-y-2" aria-label={section.title}>
									{rows.map((assignment) => {
										const former =
											section.type === "employee"
												? formerEmployees.get(assignment.employeeId ?? "")
												: undefined;
										const label =
											section.type === "organization"
												? organizationLabel
												: section.type === "team"
													? (teamNames.get(assignment.teamId ?? "") ??
														t("common.unknownTeam", "Unknown Team"))
													: (employeeNames.get(assignment.employeeId ?? "") ??
														t("common.unknownEmployee", "Unknown Employee"));
										const target: FeatureAssignmentTarget =
											section.type === "organization"
												? { type: "organization" }
												: section.type === "team"
													? { type: "team", teamId: assignment.teamId ?? "" }
													: {
															type: "employee",
															employeeId: assignment.employeeId ?? "",
														};
										return (
											<li
												key={assignment.id}
												className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${section.type === "organization" ? "bg-muted/30" : ""}`}
											>
												<div className="flex min-w-0 items-center gap-3">
													<Icon
														className="size-4 shrink-0 text-muted-foreground"
														aria-hidden="true"
													/>
													<div className="min-w-0">
														<p className="flex flex-wrap items-center gap-2 break-words font-medium">
															{label}
															{former ? <FormerEmployeeBadge since={former.since} /> : null}
														</p>
														<p className="text-xs text-muted-foreground">
															{optionLabels.get(assignment.value)}
														</p>
													</div>
												</div>
												<div className="flex max-w-full items-center gap-2">
													<Select
														value={assignment.value}
														items={options}
														disabled={pending}
														onValueChange={(value: Value | null) => {
															if (value && value !== assignment.value)
																void onSave(target, value);
														}}
													>
														<SelectTrigger
															className="h-9 w-60 min-w-0 max-w-full"
															aria-label={t(
																"settings.featureAssignments.valueFor",
																"{setting} for {target}",
																{ setting: valueLabel, target: label },
															)}
														>
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															{options.map((option) => (
																<SelectItem
																	key={option.value}
																	value={option.value}
																>
																	{option.label}
																</SelectItem>
															))}
														</SelectContent>
													</Select>
													<Button
														type="button"
														variant="ghost"
														size="icon"
														className="shrink-0 text-destructive hover:text-destructive"
														disabled={pending}
														onClick={() => void onRemove(assignment.id)}
														aria-label={t(
															"settings.featureAssignments.remove",
															"Remove {target}",
															{ target: label },
														)}
													>
														<IconTrash className="size-4" aria-hidden="true" />
													</Button>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</CardContent>
					</Card>
				);
			})}
		</>
	);
}
