"use client";

import { IconDeviceFloppy, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useRouter } from "@/navigation";
import {
	createVacationAdjustmentAction,
	getEmployeeAdjustmentTotal,
	getEmployeeAllowance,
	getVacationPolicies,
	updateEmployeeAllowance,
} from "../../actions";
import {
	getVacationPolicies as getAssignmentPolicies,
	getEmployeePolicyAssignment,
	setEmployeePolicyAssignment,
} from "../../assignment-actions";

const defaultValues = {
	policyId: "",
	customAnnualDays: "",
	customCarryoverDays: "",
	adjustmentDays: "",
	adjustmentReason: "",
};

export default function EmployeeAllowanceEditPage({
	params,
}: {
	params: Promise<{ employeeId: string }>;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [employee, setEmployee] = useState<any>(null);
	const [orgPolicy, setOrgPolicy] = useState<any>(null);
	const [policies, setPolicies] = useState<any[]>([]);
	const [currentAssignment, setCurrentAssignment] = useState<any>(null);
	const [noEmployee, setNoEmployee] = useState(false);
	const [currentYear] = useState(new Date().getFullYear());
	const [adjustmentTotal, setAdjustmentTotal] = useState(0);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setLoading(true);

			try {
				// Update policy assignment if changed
				const currentPolicyId = currentAssignment?.policyId || "";
				const newPolicyId = value.policyId || "";

				if (currentPolicyId !== newPolicyId) {
					const assignmentResult = await setEmployeePolicyAssignment(
						employeeId,
						newPolicyId || null,
					);
					if (!assignmentResult.success) {
						toast.error(assignmentResult.error || "Failed to update policy assignment");
						setLoading(false);
						return;
					}
				}

				// Update base allowance if customAnnualDays or customCarryoverDays changed
				if (value.customAnnualDays || value.customCarryoverDays) {
					const result = await updateEmployeeAllowance(employeeId, currentYear, {
						customAnnualDays: value.customAnnualDays || undefined,
						customCarryoverDays: value.customCarryoverDays || undefined,
					});

					if (!result.success) {
						toast.error(result.error || "Failed to update allowance");
						setLoading(false);
						return;
					}
				}

				// Create adjustment event if adjustment provided
				if (value.adjustmentDays && value.adjustmentReason) {
					const adjustmentResult = await createVacationAdjustmentAction(employeeId, currentYear, {
						days: value.adjustmentDays,
						reason: value.adjustmentReason,
					});

					if (!adjustmentResult.success) {
						toast.error(adjustmentResult.error || "Failed to create adjustment");
						setLoading(false);
						return;
					}
				}

				toast.success("Employee allowance updated successfully");
				router.push("/settings/vacation/employees");
			} catch (_error) {
				toast.error("An unexpected error occurred");
			} finally {
				setLoading(false);
			}
		},
	});

	useEffect(() => {
		async function loadData() {
			const current = await getCurrentEmployee();
			if (!current) {
				setNoEmployee(true);
				return;
			}

			const [empResult, policyResult, policiesResult, assignmentResult, adjustmentTotalResult] =
				await Promise.all([
					getEmployeeAllowance(employeeId, currentYear),
					getVacationPolicies(current.organizationId),
					getAssignmentPolicies(current.organizationId),
					getEmployeePolicyAssignment(employeeId),
					getEmployeeAdjustmentTotal(employeeId, currentYear),
				]);

			if (empResult.success && empResult.data) {
				setEmployee(empResult.data);
				const allowance = empResult.data.vacationAllowances[0];
				const policyId = assignmentResult.success ? assignmentResult.data?.policyId || "" : "";

				form.setFieldValue("policyId", policyId);
				form.setFieldValue("customAnnualDays", allowance?.customAnnualDays || "");
				form.setFieldValue("customCarryoverDays", allowance?.customCarryoverDays || "");
				// Don't set adjustment fields - they are for new adjustments only
				form.setFieldValue("adjustmentDays", "");
				form.setFieldValue("adjustmentReason", "");
			}

			if (policyResult.success && policyResult.data) {
				// Get the company default policy
				const defaultPolicy = policyResult.data.find((p: any) => p.isCompanyDefault && p.isActive);
				setOrgPolicy(defaultPolicy || policyResult.data[0] || null);
			}

			if (policiesResult.success && policiesResult.data) {
				// Filter to active policies only
				const activePolicies = policiesResult.data.filter((p: any) => p.isActive);
				setPolicies(activePolicies);
			}

			if (assignmentResult.success) {
				setCurrentAssignment(assignmentResult.data);
			}

			if (adjustmentTotalResult.success) {
				setAdjustmentTotal(adjustmentTotalResult.data);
			}
		}

		loadData();
	}, [employeeId, currentYear, form]);

	if (!employee) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<div className="flex items-center justify-center p-8">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</div>
		);
	}

	const allowance = employee.vacationAllowances[0];
	const defaultDays = orgPolicy?.defaultAnnualDays || "0";
	const customDays = allowance?.customAnnualDays ? parseFloat(allowance.customAnnualDays) : null;
	const annualDays = customDays !== null ? customDays : parseFloat(defaultDays);
	const carryover = allowance?.customCarryoverDays ? parseFloat(allowance.customCarryoverDays) : 0;
	const adjustments = adjustmentTotal;
	const total = annualDays + carryover + adjustments;

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage employee vacation allowances" />
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.vacation.employees.edit.title", "Edit Vacation Allowance")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vacation.employees.edit.description",
							"Configure custom vacation allowance for {{name}}",
							{ name: employee.user.name },
						)}
					</p>
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle>Employee Information</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="flex items-center gap-3">
							<UserAvatar
								image={employee.user.image}
								seed={employeeId}
								name={employee.user.name}
								size="lg"
							/>
							<div>
								<div className="font-medium">{employee.user.name}</div>
								<div className="text-sm text-muted-foreground">{employee.user.email}</div>
							</div>
						</div>

						<Separator />

						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">Team</div>
							<div>{employee.team?.name || "—"}</div>
						</div>

						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">Position</div>
							<div>{employee.position || "—"}</div>
						</div>

						<div className="space-y-2">
							<div className="text-sm text-muted-foreground">Role</div>
							<Badge>{employee.role}</Badge>
						</div>

						{employee.managers && employee.managers.length > 0 && (
							<>
								<Separator />
								<div className="space-y-2">
									<div className="text-sm text-muted-foreground">Managers</div>
									<div className="space-y-1">
										{employee.managers.map((m: any) => (
											<div key={m.id} className="flex items-center gap-2">
												<span className="text-sm">{m.manager.user.name}</span>
												{m.isPrimary && (
													<Badge variant="secondary" className="text-xs">
														Primary
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

				<Card className="lg:col-span-2">
					<CardHeader>
						<CardTitle>Vacation Allowance for {currentYear}</CardTitle>
						<CardDescription>Current balance: {total} days available</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="mb-6 grid gap-4 rounded-lg border p-4 md:grid-cols-4">
							<div className="space-y-1">
								<div className="text-sm text-muted-foreground">Annual Days</div>
								<div className="text-2xl font-bold">{annualDays}</div>
							</div>
							<div className="space-y-1">
								<div className="text-sm text-muted-foreground">Carryover</div>
								<div className="text-2xl font-bold text-green-600">+{carryover}</div>
							</div>
							<div className="space-y-1">
								<div className="text-sm text-muted-foreground">Adjustments</div>
								<div
									className={`text-2xl font-bold ${
										adjustments > 0 ? "text-green-600" : adjustments < 0 ? "text-red-600" : ""
									}`}
								>
									{adjustments > 0 ? "+" : ""}
									{adjustments}
								</div>
							</div>
							<div className="space-y-1">
								<div className="text-sm text-muted-foreground">Total Available</div>
								<div className="text-2xl font-bold">{total}</div>
							</div>
						</div>

						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							<form.Field name="policyId">
								{(field) => (
									<div className="space-y-2">
										<Label>Assigned Policy</Label>
										<Select onValueChange={field.handleChange} value={field.state.value}>
											<SelectTrigger>
												<SelectValue placeholder="Use organization/team default" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="">Use default</SelectItem>
												{policies.map((policy) => (
													<SelectItem key={policy.id} value={policy.id}>
														{policy.name} ({policy.defaultAnnualDays} days)
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{currentAssignment
												? `Currently assigned: ${currentAssignment.policy?.name}`
												: "Falls back to team or organization default policy"}
										</p>
									</div>
								)}
							</form.Field>

							<Separator />

							<form.Field name="customAnnualDays">
								{(field) => (
									<div className="space-y-2">
										<Label>Custom Annual Days (Optional)</Label>
										<Input
											type="number"
											step="0.5"
											placeholder={`Default: ${defaultDays} days`}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											Override the organization default ({defaultDays} days) for this employee
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
										)}
									</div>
								)}
							</form.Field>

							<form.Field name="customCarryoverDays">
								{(field) => (
									<div className="space-y-2">
										<Label>Carryover Days (Optional)</Label>
										<Input
											type="number"
											step="0.5"
											placeholder="0"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											Days carried over from previous year
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
										)}
									</div>
								)}
							</form.Field>

							<Separator />

							<div className="space-y-4">
								<h3 className="text-lg font-semibold">Add Manual Adjustment</h3>
								<p className="text-sm text-muted-foreground">
									Create a new adjustment entry for special circumstances (e.g., bonus days,
									corrections). Each adjustment is recorded in the audit log.
								</p>

								<form.Field name="adjustmentDays">
									{(field) => (
										<div className="space-y-2">
											<Label>Adjustment Days</Label>
											<Input
												type="number"
												step="0.5"
												placeholder="e.g., +5 or -2"
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											<p className="text-sm text-muted-foreground">
												Use positive numbers to add days, negative to subtract
											</p>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>

								<form.Field name="adjustmentReason">
									{(field) => (
										<div className="space-y-2">
											<Label>Reason for Adjustment</Label>
											<Textarea
												placeholder="Explain why this adjustment is being made..."
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
											/>
											<p className="text-sm text-muted-foreground">
												Required when making adjustments (for audit trail)
											</p>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
											)}
										</div>
									)}
								</form.Field>
							</div>

							<div className="flex justify-end gap-2">
								<Button
									type="button"
									variant="outline"
									onClick={() => router.push("/settings/vacation/employees")}
									disabled={loading}
								>
									Cancel
								</Button>
								<Button type="submit" disabled={loading}>
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									<IconDeviceFloppy className="mr-2 size-4" />
									Save Changes
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
