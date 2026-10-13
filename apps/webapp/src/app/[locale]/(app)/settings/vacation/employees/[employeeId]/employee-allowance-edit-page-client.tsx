"use client";

import { IconDeviceFloppy, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { use, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import {
	OverdrawnVacationBadge,
	VacationAllowanceExplanation,
} from "@/components/absences/vacation-allowance-explanation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { VacationBalance } from "@/lib/absences/types";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { useRouter } from "@/navigation";
import {
	createVacationAdjustmentAction,
	type EmployeeAdjustmentSummary,
	type EmployeeVacationBalanceView,
	getEmployeeAdjustmentSummary,
	getEmployeeAllowance,
	getEmployeeVacationBalance,
	getVacationPolicies,
	updateEmployeeAllowance,
} from "../../actions";
import {
	getVacationPolicies as getAssignmentPolicies,
	getEmployeePolicyAssignment,
	setEmployeePolicyAssignment,
} from "../../assignment-actions";

const defaultValues = {
	policyId: "__default__",
	customAnnualDays: "",
	customCarryoverDays: "",
	adjustmentDays: "",
	adjustmentReason: "",
};

const DEFAULT_POLICY_VALUE = "__default__";

type EmployeeAllowanceView = {
	user: { name: string; email: string; image: string | null };
	team: { name: string } | null;
	position: string | null;
	role: string;
	vacationAllowances: Array<{
		customAnnualDays: string | null;
		customCarryoverDays: string | null;
	}>;
	managers?: Array<{
		id: string;
		isPrimary: boolean;
		manager: { user: { name: string } };
	}>;
};

type VacationPolicyOption = {
	id: string;
	name: string;
	defaultAnnualDays: string;
	isActive: boolean;
	isCompanyDefault?: boolean;
};

const EMPTY_ADJUSTMENT_SUMMARY: EmployeeAdjustmentSummary = {
	manual: 0,
	accrual: 0,
	manualAdjustments: [],
};

type EmployeePolicyAssignment = {
	policyId: string;
	policy?: { name: string } | null;
};

function useEmployeeAllowanceEditor(employeeId: string) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [employee, setEmployee] = useState<EmployeeAllowanceView | null>(null);
	const [orgPolicy, setOrgPolicy] = useState<VacationPolicyOption | null>(null);
	const [policies, setPolicies] = useState<VacationPolicyOption[]>([]);
	const [currentAssignment, setCurrentAssignment] =
		useState<EmployeePolicyAssignment | null>(null);
	const [noEmployee, setNoEmployee] = useState(false);
	// The balance and its year come from the server, in the organization's timezone (#1111).
	const [balanceView, setBalanceView] =
		useState<EmployeeVacationBalanceView | null>(null);
	const currentYear = balanceView?.year ?? null;
	const [adjustmentSummary, setAdjustmentSummary] =
		useState<EmployeeAdjustmentSummary>(EMPTY_ADJUSTMENT_SUMMARY);
	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (currentYear === null) return;
			setLoading(true);
			await runWithCleanup(
				async () => {
					try {
						const currentPolicyId = currentAssignment?.policyId || "";
						const newPolicyId =
							value.policyId === DEFAULT_POLICY_VALUE
								? ""
								: value.policyId || "";

						if (currentPolicyId !== newPolicyId) {
							const assignmentResult = await setEmployeePolicyAssignment(
								employeeId,
								newPolicyId || null,
							);
							if (!assignmentResult.success) {
								toast.error(
									assignmentResult.error ||
										t(
											"settings.vacation.employees.detail.errors.updatePolicyAssignmentFailed",
											"Failed to update policy assignment",
										),
								);
								return;
							}
						}

						if (value.customAnnualDays || value.customCarryoverDays) {
							const result = await updateEmployeeAllowance(
								employeeId,
								currentYear,
								{
									customAnnualDays: value.customAnnualDays || undefined,
									customCarryoverDays: value.customCarryoverDays || undefined,
								},
							);
							if (!result.success) {
								toast.error(
									result.error ||
										t(
											"settings.vacation.employees.detail.errors.updateAllowanceFailed",
											"Failed to update allowance",
										),
								);
								return;
							}
						}

						if (value.adjustmentDays && value.adjustmentReason) {
							const adjustmentResult = await createVacationAdjustmentAction(
								employeeId,
								currentYear,
								{
									days: value.adjustmentDays,
									reason: value.adjustmentReason,
								},
							);
							if (!adjustmentResult.success) {
								toast.error(
									adjustmentResult.error ||
										t(
											"settings.vacation.employees.detail.errors.createAdjustmentFailed",
											"Failed to create adjustment",
										),
								);
								return;
							}
						}

						toast.success(
							t(
								"settings.vacation.employees.detail.updateSuccess",
								"Employee allowance updated successfully",
							),
						);
						router.push("/settings/vacation/employees");
					} catch (_error) {
						toast.error(
							t(
								"settings.vacation.employees.detail.errors.unexpected",
								"An unexpected error occurred",
							),
						);
					}
				},
				() => setLoading(false),
			);
		},
	});

	useEffect(() => {
		let cancelled = false;

		async function loadData() {
			const current = await getCurrentEmployee();
			if (cancelled) return;
			if (!current) {
				setNoEmployee(true);
				return;
			}

			const balanceResult = await getEmployeeVacationBalance(employeeId);
			if (cancelled || !balanceResult.success) return;
			const { year } = balanceResult.data;

			const [
				empResult,
				policyResult,
				policiesResult,
				assignmentResult,
				adjustmentSummaryResult,
			] = await Promise.all([
				getEmployeeAllowance(employeeId, year),
				getVacationPolicies(current.organizationId),
				getAssignmentPolicies(current.organizationId),
				getEmployeePolicyAssignment(employeeId),
				getEmployeeAdjustmentSummary(employeeId, year),
			]);
			if (cancelled) return;

			setBalanceView(balanceResult.data);
			if (empResult.success && empResult.data) {
				setEmployee(empResult.data as EmployeeAllowanceView);
				const allowance = empResult.data.vacationAllowances[0];
				const policyId = assignmentResult.success
					? assignmentResult.data?.policyId || DEFAULT_POLICY_VALUE
					: DEFAULT_POLICY_VALUE;
				form.setFieldValue("policyId", policyId);
				form.setFieldValue(
					"customAnnualDays",
					allowance?.customAnnualDays || "",
				);
				form.setFieldValue(
					"customCarryoverDays",
					allowance?.customCarryoverDays || "",
				);
				form.setFieldValue("adjustmentDays", "");
				form.setFieldValue("adjustmentReason", "");
			}

			if (policyResult.success && policyResult.data) {
				const defaultPolicy = policyResult.data.find((policy) =>
					Boolean(policy.isCompanyDefault && policy.isActive),
				);
				setOrgPolicy(defaultPolicy || policyResult.data[0] || null);
			}
			if (policiesResult.success && policiesResult.data) {
				setPolicies(
					policiesResult.data.filter(
						(policy) => policy.isActive,
					) as VacationPolicyOption[],
				);
			}
			if (assignmentResult.success) {
				setCurrentAssignment(
					assignmentResult.data as EmployeePolicyAssignment | null,
				);
			}
			if (adjustmentSummaryResult.success)
				setAdjustmentSummary(adjustmentSummaryResult.data);
		}

		void loadData();
		return () => {
			cancelled = true;
		};
	}, [employeeId, form]);

	return {
		adjustmentSummary,
		balanceView,
		currentAssignment,
		currentYear,
		employee,
		form,
		loading,
		noEmployee,
		orgPolicy,
		policies,
	};
}

type EmployeeAllowanceEditorState = ReturnType<
	typeof useEmployeeAllowanceEditor
>;
type EmployeeAllowanceFormApi = EmployeeAllowanceEditorState["form"];

export function EmployeeAllowanceEditPageClient({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const router = useRouter();
	const assignedPolicyId = useId();
	const customAnnualDaysId = useId();
	const carryoverDaysId = useId();
	const {
		adjustmentSummary,
		balanceView,
		currentAssignment,
		currentYear,
		employee,
		form,
		loading,
		noEmployee,
		orgPolicy,
		policies,
	} = useEmployeeAllowanceEditor(employeeId);

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t(
						"settings.vacation.employees.detail.manageAllowances",
						"manage employee vacation allowances",
					)}
				/>
			</div>
		);
	}

	if (!employee || currentYear === null) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div className="flex items-center justify-center p-8">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	const defaultDays = orgPolicy?.defaultAnnualDays || "0";
	// The server-side balance (#1111): the same numbers as the employee's Absences page. Without a
	// company default policy for the year there is none.
	const balance = balanceView?.balance ?? null;

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t(
							"settings.vacation.employees.edit.title",
							"Edit Vacation Allowance",
						)}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vacation.employees.edit.description",
							"Configure custom vacation allowance for {name}",
							{ name: employee.user.name },
						)}
					</p>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<EmployeeInformationCard employee={employee} employeeId={employeeId} />

				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>
							{t(
								"settings.vacation.employees.detail.allowanceForYear",
								"Vacation Allowance for {year}",
								{ year: currentYear },
							)}
						</CardTitle>
						{balance && (
							<CardDescription>
								{/* The vacation balance: what is left after approved and pending vacation. */}
								{t(
									"settings.vacation.employees.detail.currentBalance",
									"Current balance: {total} days available",
									{ total: balance.remainingDays },
								)}
							</CardDescription>
						)}
					</CardHeader>
					<CardContent>
						{balance ? (
							<>
								<AllowanceBalanceSummary
									balance={balance}
									accrualPolicy={balanceView?.accrualPolicy ?? false}
									accrued={adjustmentSummary.accrual}
									adjustments={adjustmentSummary.manual}
								/>
								<div className="-mt-4 mb-6 flex flex-wrap items-center gap-2">
									<VacationAllowanceExplanation
										allowance={balance.allowance}
										year={currentYear}
									/>
									<OverdrawnVacationBadge
										overdrawnDays={balance.overdrawnDays}
									/>
								</div>
							</>
						) : (
							<p className="mb-6 text-sm text-muted-foreground">
								{t(
									"settings.vacation.employees.detail.noPolicyForYear",
									"No company default vacation policy applies in {year}, so there is no balance yet.",
									{ year: currentYear },
								)}
							</p>
						)}

						<ManualAdjustmentHistory
							adjustments={adjustmentSummary.manualAdjustments}
							year={currentYear}
						/>

						<form
							action={() => {
								void form.handleSubmit();
							}}
							className="space-y-6"
						>
							<form.Field name="policyId">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={assignedPolicyId}>
											{t(
												"settings.vacation.employees.detail.assignedPolicy",
												"Assigned Policy",
											)}
										</Label>
										<Select
											onValueChange={field.handleChange}
											value={field.state.value}
										>
											<SelectTrigger id={assignedPolicyId}>
												<SelectValue
													placeholder={t(
														"settings.vacation.employees.detail.useOrganizationTeamDefault",
														"Use organization/team default",
													)}
												/>
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={DEFAULT_POLICY_VALUE}>
													{t(
														"settings.vacation.employees.detail.useDefault",
														"Use default",
													)}
												</SelectItem>
												{policies.map((policy) => (
													<SelectItem key={policy.id} value={policy.id}>
														{t(
															"settings.vacation.employees.detail.policyOptionDays",
															"{name} ({days} days)",
															{
																name: policy.name,
																days: policy.defaultAnnualDays,
															},
														)}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{currentAssignment
												? t(
														"settings.vacation.employees.detail.currentlyAssigned",
														"Currently assigned: {name}",
														{ name: currentAssignment.policy?.name },
													)
												: t(
														"settings.vacation.employees.detail.fallsBackToDefaultPolicy",
														"Falls back to team or organization default policy",
													)}
										</p>
									</div>
								)}
							</form.Field>

							<Separator />

							<form.Field name="customAnnualDays">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={customAnnualDaysId}>
											{t(
												"settings.vacation.employees.detail.customAnnualDaysOptional",
												"Custom Annual Days (Optional)",
											)}
										</Label>
										<Input
											id={customAnnualDaysId}
											type="number"
											step="0.5"
											placeholder={t(
												"settings.vacation.employees.detail.defaultDaysPlaceholder",
												"Default: {days} days",
												{
													days: defaultDays,
												},
											)}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.employees.detail.overrideOrganizationDefault",
												"Override the organization default ({days} days) for this employee",
												{ days: defaultDays },
											)}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							<form.Field name="customCarryoverDays">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor={carryoverDaysId}>
											{t(
												"settings.vacation.employees.detail.carryoverDaysOptional",
												"Carryover Days (Optional)",
											)}
										</Label>
										<Input
											id={carryoverDaysId}
											type="number"
											step="0.5"
											placeholder="0"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.vacation.employees.detail.daysCarriedOverDescription",
												"Days carried over from previous year",
											)}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							<Separator />

							<ManualAdjustmentFields form={form} />

							<div className="flex justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => router.push("/settings/vacation/employees")}
									disabled={loading}
								>
									{t("settings.vacation.employees.detail.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={loading}>
									{loading && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
									<IconDeviceFloppy className="mr-2 size-4" />
									{t(
										"settings.vacation.employees.detail.saveChanges",
										"Save Changes",
									)}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

function EmployeeInformationCard({
	employee,
	employeeId,
}: {
	employee: EmployeeAllowanceView;
	employeeId: string;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.vacation.employees.detail.employeeInformation",
						"Employee Information",
					)}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3">
					<UserAvatar
						image={employee.user.image}
						seed={employeeId}
						name={employee.user.name}
						size="lg"
						clockStatus="unknown"
					/>
					<div>
						<div className="font-medium">{employee.user.name}</div>
						<div className="text-sm text-muted-foreground">
							{employee.user.email}
						</div>
					</div>
				</div>

				<Separator />

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.vacation.employees.detail.team", "Team")}
					</div>
					<div>{employee.team?.name || "—"}</div>
				</div>
				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.vacation.employees.detail.position", "Position")}
					</div>
					<div>{employee.position || "—"}</div>
				</div>
				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.vacation.employees.detail.role", "Role")}
					</div>
					<Badge>{employee.role}</Badge>
				</div>

				{employee.managers && employee.managers.length > 0 && (
					<>
						<Separator />
						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">
								{t("settings.vacation.employees.detail.managers", "Managers")}
							</div>
							<div className="space-y-1">
								{employee.managers.map((manager) => (
									<div key={manager.id} className="flex items-center gap-2">
										<span className="text-sm">{manager.manager.user.name}</span>
										{manager.isPrimary && (
											<Badge variant="secondary" className="text-xs">
												{t(
													"settings.vacation.employees.detail.primary",
													"Primary",
												)}
											</Badge>
										)}
									</div>
								))}
							</div>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function AllowanceBalanceSummary({
	balance,
	accrualPolicy,
	accrued,
	adjustments,
}: {
	/** The server-side balance of the year (#1111). */
	balance: VacationBalance;
	/** A monthly or biweekly policy: the balance starts at 0 and grows by accrual (#1106). */
	accrualPolicy: boolean;
	/** The accrual adjustments so far this year. */
	accrued: number;
	/** The manual adjustments of the year. */
	adjustments: number;
}) {
	const { t } = useTranslate();
	// Accrual rows can remain after a policy switched to annual, so show them whenever present.
	const showAccrued = accrualPolicy || accrued !== 0;
	const showAllowance = !accrualPolicy;
	const carryover = balance.carryoverDays ?? 0;
	return (
		<div
			className={`mb-6 grid gap-4 rounded-lg border p-4 ${
				showAccrued && showAllowance ? "md:grid-cols-5" : "md:grid-cols-4"
			}`}
		>
			{showAllowance && (
				<div className="space-y-1">
					<div className="text-sm text-muted-foreground">
						{t("settings.vacation.employees.detail.allowance", "Allowance")}
					</div>
					{/* The custom or policy allowance, prorated in a start or exit year (#1110). */}
					<div className="text-2xl font-bold">{balance.allowanceDays}</div>
				</div>
			)}
			{showAccrued && (
				<div className="space-y-1">
					<div className="text-sm text-muted-foreground">
						{t(
							"settings.vacation.employees.detail.accruedToDate",
							"Accrued to Date",
						)}
					</div>
					<div className="text-2xl font-bold">{accrued}</div>
					{accrualPolicy && balance.allowance && (
						<div className="text-xs text-muted-foreground">
							{t(
								"settings.vacation.employees.detail.accruedOfAnnualDays",
								"of {days} days per year",
								{ days: balance.allowance.fullAllowance },
							)}
						</div>
					)}
				</div>
			)}
			<div className="space-y-1">
				<div className="text-sm text-muted-foreground">
					{t("settings.vacation.employees.detail.carryover", "Carryover")}
				</div>
				<div className="text-2xl font-bold text-green-600">+{carryover}</div>
			</div>
			<div className="space-y-1">
				<div className="text-sm text-muted-foreground">
					{t("settings.vacation.employees.detail.adjustments", "Adjustments")}
				</div>
				<div
					className={`text-2xl font-bold ${
						adjustments > 0
							? "text-green-600"
							: adjustments < 0
								? "text-red-600"
								: ""
					}`}
				>
					{adjustments > 0 ? "+" : ""}
					{adjustments}
				</div>
			</div>
			<div className="space-y-1">
				<div className="text-sm text-muted-foreground">
					{t(
						"settings.vacation.employees.detail.totalAvailable",
						"Total Available",
					)}
				</div>
				<div className="text-2xl font-bold">{balance.totalDays}</div>
			</div>
		</div>
	);
}

/** The year's manual adjustments, newest first; accrual shares are summed above (#1106). */
function ManualAdjustmentHistory({
	adjustments,
	year,
}: {
	adjustments: EmployeeAdjustmentSummary["manualAdjustments"];
	year: number;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	return (
		<div className="mb-6 space-y-2">
			<h3 className="text-sm font-medium">
				{t(
					"settings.vacation.employees.detail.adjustmentHistory",
					"Adjustment History",
				)}
			</h3>
			{adjustments.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.vacation.employees.detail.adjustmentHistoryEmpty",
						"No manual adjustments in {year}.",
						{ year },
					)}
				</p>
			) : (
				<ul className="divide-y rounded-md border">
					{adjustments.map((adjustment) => (
						<li key={adjustment.id} className="space-y-1 p-3">
							<span
								className={`text-sm font-medium tabular-nums ${
									adjustment.days > 0 ? "text-green-600" : "text-red-600"
								}`}
							>
								{adjustment.days > 0 ? "+" : ""}
								{adjustment.days}
							</span>
							<p className="break-words text-sm">{adjustment.reason}</p>
							<p className="text-xs text-muted-foreground">
								{t(
									"settings.vacation.employees.detail.adjustmentRecordedBy",
									"By {name} on {date}",
									{
										name:
											adjustment.adjustedByName ??
											t(
												"settings.vacation.employees.detail.adjustmentUnknownUser",
												"a deleted user",
											),
										date: formatInstant(
											parseInstant(adjustment.createdAt),
											displayContext,
											"dateTimeMedium",
										),
									},
								)}
							</p>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function ManualAdjustmentFields({ form }: { form: EmployeeAllowanceFormApi }) {
	const { t } = useTranslate();
	const adjustmentDaysId = useId();
	const adjustmentReasonId = useId();
	return (
		<div className="space-y-4">
			<h3 className="text-lg font-semibold">
				{t(
					"settings.vacation.employees.detail.addManualAdjustment",
					"Add Manual Adjustment",
				)}
			</h3>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.vacation.employees.detail.addManualAdjustmentDescription",
					"Create a new adjustment entry for special circumstances (e.g., bonus days, corrections). Each adjustment is recorded in the audit log.",
				)}
			</p>

			<form.Field name="adjustmentDays">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor={adjustmentDaysId}>
							{t(
								"settings.vacation.employees.detail.adjustmentDays",
								"Adjustment Days",
							)}
						</Label>
						<Input
							id={adjustmentDaysId}
							type="number"
							step="0.5"
							placeholder={t(
								"settings.vacation.employees.detail.adjustmentDaysPlaceholder",
								"e.g., +5 or -2",
							)}
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
						/>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.vacation.employees.detail.adjustmentDaysDescription",
								"Use positive numbers to add days, negative to subtract",
							)}
						</p>
						{field.state.meta.errors.length > 0 && (
							<p className="text-sm text-destructive">
								{field.state.meta.errors[0]}
							</p>
						)}
					</div>
				)}
			</form.Field>

			<form.Field name="adjustmentReason">
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor={adjustmentReasonId}>
							{t(
								"settings.vacation.employees.detail.reasonForAdjustment",
								"Reason for Adjustment",
							)}
						</Label>
						<Textarea
							id={adjustmentReasonId}
							placeholder={t(
								"settings.vacation.employees.detail.adjustmentReasonPlaceholder",
								"Explain why this adjustment is being made...",
							)}
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
						/>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.vacation.employees.detail.adjustmentReasonDescription",
								"Required when making adjustments (for audit trail)",
							)}
						</p>
						{field.state.meta.errors.length > 0 && (
							<p className="text-sm text-destructive">
								{field.state.meta.errors[0]}
							</p>
						)}
					</div>
				)}
			</form.Field>
		</div>
	);
}
