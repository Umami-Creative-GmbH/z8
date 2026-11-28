"use client";

import { IconAlertCircle, IconDeviceFloppy, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { use, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { HistoricalVacationUsageCard } from "@/components/absences/historical-vacation-usage-card";
import { PreviouslyTakenVacationExplanation } from "@/components/absences/previously-taken-vacation-explanation";
import {
	OverdrawnVacationBadge,
	VacationAllowanceExplanation,
} from "@/components/absences/vacation-allowance-explanation";
import { VacationPolicyConfigurationMessage } from "@/components/absences/vacation-policy-configuration-message";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { SettingsLoadError } from "@/components/settings/settings-load-error";
import { EmployeeLeaveNoticesCard } from "@/components/settings/vacation/employee-leave-notices";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { VacationBalance } from "@/lib/absences/types";
import { instantFromDate, parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant, formatPlainDate } from "@/lib/datetime/temporal-format";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { useRouter } from "@/navigation";
import {
	createVacationAdjustmentAction,
	type EmployeeAdjustmentSummary,
	type EmployeeVacationBalanceView,
	getEmployeeAdjustmentSummary,
	getEmployeeAllowance,
	getEmployeeVacationBalance,
	updateEmployeeAllowance,
} from "../../actions";
import {
	getVacationPolicies as getAssignmentPolicies,
	getEmployeePolicyAssignment,
	setEmployeePolicyAssignment,
} from "../../assignment-actions";
import {
	type AllowanceSaveOutcome,
	type AllowanceSaveStep,
	type AllowanceSaveStepPlan,
	type AllowanceSaveStepResult,
	runAllowanceSaveSteps,
	type SavedAllowanceSteps,
} from "./allowance-save-steps";

const defaultValues = {
	policyId: "__default__",
	customAnnualDays: "",
	customCarryoverDays: "",
	adjustmentDays: "",
	adjustmentReason: "",
};

const DEFAULT_POLICY_VALUE = "__default__";

/** Added days, in the theme's success token; the sign carries the meaning on its own. */
const POSITIVE_DAYS_CLASS = "text-success";

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

type FailedAllowanceSave = Extract<AllowanceSaveOutcome, { status: "failed" }>;

/** A save action's result as a step result; the server's message is kept for the alert. */
function stepResult(
	result: { success: true } | { success: false; error?: string | null },
): AllowanceSaveStepResult {
	return result.success
		? { success: true }
		: { success: false, error: result.error ?? undefined };
}

function useEmployeeAllowanceEditor(employeeId: string) {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [employee, setEmployee] = useState<EmployeeAllowanceView | null>(null);
	const [policies, setPolicies] = useState<VacationPolicyOption[]>([]);
	const [currentAssignment, setCurrentAssignment] =
		useState<EmployeePolicyAssignment | null>(null);
	// A failed read of the employee, policies or balance; shown only while nothing is loaded yet.
	const [loadFailed, setLoadFailed] = useState(false);
	// The balance and its year come from the server, in the organization's timezone (#1111).
	const [balanceView, setBalanceView] =
		useState<EmployeeVacationBalanceView | null>(null);
	const currentYear = balanceView?.year ?? null;
	const [adjustmentSummary, setAdjustmentSummary] =
		useState<EmployeeAdjustmentSummary>(EMPTY_ADJUSTMENT_SUMMARY);
	// What each save step wrote since the last complete save, so a retry skips it.
	const savedSteps = useRef<SavedAllowanceSteps>(new Map());
	// A save that stopped partway: what was saved, what failed, what is still to do.
	const [saveFailure, setSaveFailure] = useState<FailedAllowanceSave | null>(
		null,
	);
	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (currentYear === null) return;
			setLoading(true);
			await runWithCleanup(
				async () => {
					const currentPolicyId = currentAssignment?.policyId || "";
					const newPolicyId =
						value.policyId === DEFAULT_POLICY_VALUE
							? ""
							: value.policyId || "";
					const plans: AllowanceSaveStepPlan[] = [];

					if (currentPolicyId !== newPolicyId) {
						plans.push({
							step: "policy",
							signature: newPolicyId,
							run: async () =>
								stepResult(
									await setEmployeePolicyAssignment({
										employeeId,
										policyId: newPolicyId || null,
									}),
								),
						});
					}

					if (value.customAnnualDays || value.customCarryoverDays) {
						plans.push({
							step: "allowance",
							signature: JSON.stringify([
								currentYear,
								value.customAnnualDays,
								value.customCarryoverDays,
							]),
							run: async () =>
								stepResult(
									await updateEmployeeAllowance({
										employeeId,
										year: currentYear,
										data: {
											customAnnualDays: value.customAnnualDays || undefined,
											customCarryoverDays:
												value.customCarryoverDays || undefined,
										},
									}),
								),
						});
					}

					if (value.adjustmentDays && value.adjustmentReason) {
						plans.push({
							step: "adjustment",
							signature: JSON.stringify([
								currentYear,
								value.adjustmentDays,
								value.adjustmentReason,
							]),
							run: async () =>
								stepResult(
									await createVacationAdjustmentAction({
										employeeId,
										year: currentYear,
										data: {
											days: value.adjustmentDays,
											reason: value.adjustmentReason,
										},
									}),
								),
						});
					}

					const outcome = await runAllowanceSaveSteps(
						plans,
						savedSteps.current,
					);
					if (outcome.status === "failed") {
						// Keep the entered values and show the saved parts as they are now.
						setSaveFailure(outcome);
						if (outcome.saved.length > 0) void runLoadData(true);
						return;
					}

					savedSteps.current.clear();
					setSaveFailure(null);
					toast.success(
						t(
							"settings.vacation.employees.detail.updateSuccess",
							"Employee allowance updated successfully",
						),
					);
					router.push("/settings/vacation/employees");
				},
				() => setLoading(false),
			);
		},
	});

	const loadGeneration = useRef(0);

	const runLoadData = useCallback(
		async (background = false) => {
			const generation = ++loadGeneration.current;
			setLoadFailed(false);
			try {
			const balanceResult = await getEmployeeVacationBalance(employeeId);
			if (generation !== loadGeneration.current) return;
			if (!balanceResult.success) {
				setLoadFailed(true);
				return;
			}
			const { year } = balanceResult.data;

			const [
				empResult,
				policiesResult,
				assignmentResult,
				adjustmentSummaryResult,
			] = await Promise.all([
				getEmployeeAllowance({ employeeId, year }),
				getAssignmentPolicies(),
				getEmployeePolicyAssignment(employeeId),
				getEmployeeAdjustmentSummary({ employeeId, year }),
			]);
			if (generation !== loadGeneration.current) return;

			setBalanceView(balanceResult.data);
			if (!empResult.success || !empResult.data) setLoadFailed(true);
			if (empResult.success && empResult.data) {
				setEmployee(empResult.data as EmployeeAllowanceView);
				if (!background || !form.store.state.isDirty) {
					const allowance = empResult.data.vacationAllowances[0];
					const policyId = assignmentResult.success
						? assignmentResult.data?.policyId || DEFAULT_POLICY_VALUE
						: DEFAULT_POLICY_VALUE;
					form.reset(
						{
							policyId,
							customAnnualDays: allowance?.customAnnualDays || "",
							customCarryoverDays: allowance?.customCarryoverDays || "",
							adjustmentDays: "",
							adjustmentReason: "",
						},
						{ keepDefaultValues: true },
					);
				}
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
			} catch {
				if (generation === loadGeneration.current) setLoadFailed(true);
			}
		},
		[employeeId, form],
	);
	useViewRefresh(() => runLoadData(true));
	useEffect(() => {
		let active = true;
		queueMicrotask(() => {
			if (active) void runLoadData();
		});
		return () => {
			active = false;
			loadGeneration.current += 1;
		};
	}, [runLoadData]);

	return {
		loadFailed,
		retry: () => runLoadData(),
		reload: () => runLoadData(true),
		adjustmentSummary,
		balanceView,
		currentAssignment,
		currentYear,
		employee,
		form,
		loading,
		policies,
		saveFailure,
	};
}

type EmployeeAllowanceEditorState = ReturnType<
	typeof useEmployeeAllowanceEditor
>;
type EmployeeAllowanceFormApi = EmployeeAllowanceEditorState["form"];

export function EmployeeAllowanceEditPageClient({
	params,
	organizationId,
}: {
	params: Promise<{ employeeId: string }>;
	organizationId: string;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const router = useRouter();
	const {
		adjustmentSummary,
		balanceView,
		currentAssignment,
		currentYear,
		employee,
		form,
		loading,
		policies,
		loadFailed,
		retry,
		reload,
		saveFailure,
	} = useEmployeeAllowanceEditor(employeeId);
	const historicalAdminOrganizationId = organizationId;
	const pageTitle = t(
		"settings.vacation.employees.edit.title",
		"Edit Vacation Allowance",
	);

	if (!employee || currentYear === null) {
		if (loadFailed) {
			return (
				<div className="page-frame">
					<div className="page-measure space-y-6">
						<PageHeader title={pageTitle} />
						<SettingsLoadError
							message={t(
								"settings.vacation.employees.detail.errors.loadFailed",
								"The employee's vacation allowance could not be loaded.",
							)}
							onRetry={() => void retry()}
						/>
						<Button
							type="button"
							variant="outline"
							onClick={() => router.push("/settings/vacation/employees")}
						>
							{t(
								"settings.vacation.employees.detail.backToAllowances",
								"Back to employee allowances",
							)}
						</Button>
					</div>
				</div>
			);
		}
		return (
			<LoadingRegion
				className="page-frame"
				label={{
					labelKey: "common.loadingRegions.employeeVacationAllowance",
					labelDefault: "Loading employee vacation allowance",
				}}
			>
				<div className="page-measure space-y-6">
					<div className="space-y-2">
						<Skeleton aria-hidden="true" className="h-8 w-64 max-w-full" />
						<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
					</div>
					<div className="grid gap-4 lg:grid-cols-3">
						<Skeleton aria-hidden="true" className="h-72 w-full" />
						<Skeleton aria-hidden="true" className="h-96 w-full lg:col-span-2" />
					</div>
				</div>
			</LoadingRegion>
		);
	}

	const defaultDays = balanceView?.policy?.defaultAnnualDays ?? "—";
	// Use the same balance and effective employee policy as the employee's Absences page.
	const balance = balanceView?.balance ?? null;

	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
			<PageHeader
				title={pageTitle}
				description={t(
					"settings.vacation.employees.edit.description",
					"Configure custom vacation allowance for {name}",
					{ name: employee.user.name },
				)}
			/>

			<div className="grid gap-4 lg:grid-cols-3">
				<EmployeeInformationCard employee={employee} employeeId={employeeId} />

				<Card className="min-w-0 lg:col-span-2">
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
								<CarryoverExpiryNotice
									balance={balance}
									timezone={balanceView?.timezone ?? "UTC"}
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
							<VacationPostingConfigurationNotice
								configuration={balanceView?.configuration ?? null}
							/>
						)}

						<PreviouslyTakenVacationExplanation
							days={balance?.previouslyTakenDays}
							className="mb-4 text-sm text-muted-foreground"
						/>
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
							<AllowanceSettingsFields
								form={form}
								policies={policies}
								currentAssignment={currentAssignment}
								defaultDays={defaultDays}
							/>

							<Separator />

							<ManualAdjustmentFields form={form} />

							{saveFailure ? (
								<PartialSaveAlert
									failure={saveFailure}
									isRetrying={loading}
									onRetry={() => void form.handleSubmit()}
								/>
							) : null}

							<div className="flex flex-wrap justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => router.push("/settings/vacation/employees")}
									disabled={loading}
								>
									{t("settings.vacation.employees.detail.cancel", "Cancel")}
								</Button>
								<Button type="submit" disabled={loading}>
									{loading ? (
										<IconLoader2
											aria-hidden="true"
											className="mr-2 size-4 animate-spin"
										/>
									) : (
										<IconDeviceFloppy aria-hidden="true" className="mr-2 size-4" />
									)}
									{t(
										"settings.vacation.employees.detail.saveChanges",
										"Save Changes",
									)}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
				{historicalAdminOrganizationId && (
					// Supporting history below the allowance it explains.
					<div className="min-w-0 lg:col-span-3">
						<HistoricalVacationUsageCard
							organizationId={historicalAdminOrganizationId}
							employeeId={employeeId}
							initialYear={currentYear}
							onSaved={reload}
						/>
					</div>
				)}
				<div className="min-w-0 lg:col-span-3">
					<EmployeeLeaveNoticesCard employeeId={employeeId} />
				</div>
			</div>
			</div>
		</div>
	);
}

function AllowanceSettingsFields({
	form,
	policies,
	currentAssignment,
	defaultDays,
}: {
	form: EmployeeAllowanceFormApi;
	policies: EmployeeAllowanceEditorState["policies"];
	currentAssignment: EmployeeAllowanceEditorState["currentAssignment"];
	defaultDays: string;
}) {
	const { t } = useTranslate();
	const assignedPolicyId = useId();
	const customAnnualDaysId = useId();
	const carryoverDaysId = useId();
	return (
		<>
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
								"settings.vacation.employees.detail.overrideEffectivePolicy",
								"Override the assigned policy allowance ({days} days) for this employee",
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
		</>
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
		// Columns follow the card's width, not the viewport, so values never squeeze.
		<div className="mb-6 grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-4 rounded-lg border p-4">
			{showAllowance && (
				<div className="space-y-1">
					<div className="text-sm text-muted-foreground">
						{t("settings.vacation.employees.detail.allowance", "Allowance")}
					</div>
					{/* The custom or policy allowance, prorated in a start or exit year (#1110). */}
					<div className="text-2xl font-bold tabular-nums">{balance.allowanceDays}</div>
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
					<div className="text-2xl font-bold tabular-nums">{accrued}</div>
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
				<div className={`text-2xl font-bold tabular-nums ${POSITIVE_DAYS_CLASS}`}>
					+{carryover}
				</div>
			</div>
			<div className="space-y-1">
				<div className="text-sm text-muted-foreground">
					{t("settings.vacation.employees.detail.adjustments", "Adjustments")}
				</div>
				<div
					className={`text-2xl font-bold tabular-nums ${
						adjustments > 0
							? POSITIVE_DAYS_CLASS
							: adjustments < 0
								? "text-destructive"
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
				<div className="text-2xl font-bold tabular-nums">{balance.totalDays}</div>
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
									adjustment.days > 0 ? POSITIVE_DAYS_CLASS : "text-destructive"
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

/**
 * A save that stopped partway: which parts were saved, which failed and why, and which were not
 * attempted. The form keeps the entered values; Retry runs only the failed and remaining steps.
 */
export function PartialSaveAlert({
	failure,
	isRetrying,
	onRetry,
}: {
	failure: FailedAllowanceSave;
	isRetrying: boolean;
	onRetry: () => void;
}) {
	const { t } = useTranslate();
	const savedText: Record<AllowanceSaveStep, string> = {
		policy: t(
			"settings.vacation.employees.detail.partialSave.saved.policy",
			"Policy assignment saved.",
		),
		allowance: t(
			"settings.vacation.employees.detail.partialSave.saved.allowance",
			"Custom allowance saved.",
		),
		adjustment: t(
			"settings.vacation.employees.detail.partialSave.saved.adjustment",
			"Manual adjustment saved.",
		),
	};
	const pendingText: Record<AllowanceSaveStep, string> = {
		policy: t(
			"settings.vacation.employees.detail.partialSave.pending.policy",
			"Policy assignment not saved yet.",
		),
		allowance: t(
			"settings.vacation.employees.detail.partialSave.pending.allowance",
			"Custom allowance not saved yet.",
		),
		adjustment: t(
			"settings.vacation.employees.detail.partialSave.pending.adjustment",
			"Manual adjustment not saved yet.",
		),
	};
	// The server's reason, or the step's existing failure message when it gave none.
	const reason =
		failure.failed.error ??
		{
			policy: t(
				"settings.vacation.employees.detail.errors.updatePolicyAssignmentFailed",
				"Failed to update policy assignment",
			),
			allowance: t(
				"settings.vacation.employees.detail.errors.updateAllowanceFailed",
				"Failed to update allowance",
			),
			adjustment: t(
				"settings.vacation.employees.detail.errors.createAdjustmentFailed",
				"Failed to create adjustment",
			),
		}[failure.failed.step];
	const failedText = {
		policy: t(
			"settings.vacation.employees.detail.partialSave.failed.policy",
			"Policy assignment could not be saved: {reason}",
			{ reason },
		),
		allowance: t(
			"settings.vacation.employees.detail.partialSave.failed.allowance",
			"Custom allowance could not be saved: {reason}",
			{ reason },
		),
		adjustment: t(
			"settings.vacation.employees.detail.partialSave.failed.adjustment",
			"Manual adjustment could not be saved: {reason}",
			{ reason },
		),
	}[failure.failed.step];

	return (
		<Alert variant="destructive">
			<IconAlertCircle aria-hidden="true" />
			<AlertTitle>
				{failure.saved.length > 0
					? t(
							"settings.vacation.employees.detail.partialSave.title",
							"Some changes were not saved",
						)
					: t(
							"settings.vacation.employees.detail.partialSave.titleNothingSaved",
							"Changes were not saved",
						)}
			</AlertTitle>
			<AlertDescription>
				<ul className="list-disc space-y-1 ps-4">
					{failure.saved.map((step) => (
						<li key={step}>{savedText[step]}</li>
					))}
					<li>{failedText}</li>
					{failure.pending.map((step) => (
						<li key={step}>{pendingText[step]}</li>
					))}
				</ul>
				<p>
					{t(
						"settings.vacation.employees.detail.partialSave.description",
						"Your entries are kept. Retry saves only what is still missing.",
					)}
				</p>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="mt-1"
					disabled={isRetrying}
					onClick={onRetry}
				>
					{isRetrying ? (
						<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
					) : null}
					{t("settings.vacation.employees.detail.partialSave.retry", "Retry unsaved changes")}
				</Button>
			</AlertDescription>
		</Alert>
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

			<form.Field
				name="adjustmentReason"
				validators={{
					// Days without a reason were silently skipped on save; say so beside the field.
					onSubmit: ({ value, fieldApi }) =>
						fieldApi.form.getFieldValue("adjustmentDays") && !value.trim()
							? t(
									"settings.vacation.employees.detail.errors.adjustmentReasonRequired",
									"Enter a reason to record this adjustment.",
								)
							: undefined,
				}}
			>
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

function CarryoverExpiryNotice({
	balance,
	timezone,
}: {
	balance: VacationBalance;
	timezone: string;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const carryoverTimezone = balance.carryoverExpiryTimezone ?? timezone;
	if (!balance.carryoverExpiryDate) {
		return balance.carryoverDays && balance.carryoverDays > 0 ? (
			<p className="mb-6 text-sm text-muted-foreground">
				{t(
					"settings.vacation.employees.detail.carryoverNoExpiry",
					"Carryover has no expiry date.",
				)}
			</p>
		) : null;
	}
	return (
		<p className="mb-6 text-sm text-muted-foreground">
			{t(
				"settings.vacation.employees.detail.carryoverExpiry",
				"Carryover expires on {date} ({timezone}).",
				{
					date: formatPlainDate(
						instantFromDate(balance.carryoverExpiryDate)
							.toZonedDateTimeISO(carryoverTimezone)
							.toPlainDate(),
						displayContext.locale,
						"dateMedium",
					),
					timezone: carryoverTimezone,
				},
			)}
		</p>
	);
}

function VacationPostingConfigurationNotice({
	configuration,
}: {
	configuration: EmployeeVacationBalanceView["configuration"];
}) {
	const { t } = useTranslate();
	return (
		<div className="mb-6 space-y-1 text-sm text-muted-foreground">
			<VacationPolicyConfigurationMessage configuration={configuration} />
			{(configuration?.status === "missing" ||
				configuration?.status === "conflict") && (
				<p>
					{t(
						"settings.vacation.employees.detail.postingsSkipped",
						"Automatic vacation postings are skipped until the policy configuration is resolved.",
					)}
				</p>
			)}
		</div>
	);
}
