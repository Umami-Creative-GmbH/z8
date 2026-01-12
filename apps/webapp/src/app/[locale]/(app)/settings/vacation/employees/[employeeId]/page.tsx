"use client";

import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { IconDeviceFloppy, IconLoader2 } from "@tabler/icons-react";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { getCurrentEmployee } from "@/app/[locale]/(app)/approvals/actions";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { useRouter } from "@/navigation";
import { getEmployeeAllowance, getVacationPolicies, updateEmployeeAllowance } from "../../actions";
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
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [employee, setEmployee] = useState<any>(null);
	const [orgPolicy, setOrgPolicy] = useState<any>(null);
	const [policies, setPolicies] = useState<any[]>([]);
	const [currentAssignment, setCurrentAssignment] = useState<any>(null);
	const [noEmployee, setNoEmployee] = useState(false);
	const [currentYear] = useState(new Date().getFullYear());

	const form = useForm({
		defaultValues,
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			setLoading(true);

			try {
				// Update policy assignment if changed
				const currentPolicyId = currentAssignment?.policyId || "";
				const newPolicyId = value.policyId || "";

				if (currentPolicyId !== newPolicyId) {
					const assignmentResult = await setEmployeePolicyAssignment(employeeId, newPolicyId || null);
					if (!assignmentResult.success) {
						toast.error(assignmentResult.error || "Failed to update policy assignment");
						setLoading(false);
						return;
					}
				}

				// Update allowance
				const result = await updateEmployeeAllowance(employeeId, currentYear, {
					customAnnualDays: value.customAnnualDays || undefined,
					customCarryoverDays: value.customCarryoverDays || undefined,
					adjustmentDays: value.adjustmentDays || undefined,
					adjustmentReason: value.adjustmentReason || undefined,
				});

				if (result.success) {
					toast.success("Employee allowance updated successfully");
					router.push("/settings/vacation/employees");
					router.refresh();
				} else {
					toast.error(result.error || "Failed to update allowance");
				}
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

			const [empResult, policyResult, policiesResult, assignmentResult] = await Promise.all([
				getEmployeeAllowance(employeeId, currentYear),
				getVacationPolicies(current.organizationId, currentYear),
				getAssignmentPolicies(current.organizationId),
				getEmployeePolicyAssignment(employeeId),
			]);

			if (empResult.success && empResult.data) {
				setEmployee(empResult.data);
				const allowance = empResult.data.vacationAllowances[0];
				const policyId = assignmentResult.success ? assignmentResult.data?.policyId || "" : "";

				form.setFieldValue("policyId", policyId);
				form.setFieldValue("customAnnualDays", allowance?.customAnnualDays || "");
				form.setFieldValue("customCarryoverDays", allowance?.customCarryoverDays || "");
				form.setFieldValue("adjustmentDays", allowance?.adjustmentDays || "");
				form.setFieldValue("adjustmentReason", allowance?.adjustmentReason || "");
			}

			if (policyResult.success && policyResult.data) {
				// Get the first policy for the current year as org default
				setOrgPolicy(policyResult.data[0] || null);
			}

			if (policiesResult.success && policiesResult.data) {
				// Filter to current year policies
				const yearPolicies = policiesResult.data.filter((p: any) => p.year === currentYear);
				setPolicies(yearPolicies);
			}

			if (assignmentResult.success) {
				setCurrentAssignment(assignmentResult.data);
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
	const adjustments = allowance?.adjustmentDays ? parseFloat(allowance.adjustmentDays) : 0;
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
					<h1 className="text-2xl font-semibold tracking-tight">Edit Vacation Allowance</h1>
					<p className="text-sm text-muted-foreground">
						Configure custom vacation allowance for {employee.user.name}
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
							<Avatar className="size-12">
								<AvatarImage src={employee.user.image || undefined} />
								<AvatarFallback>
									{employee.user.name
										.split(" ")
										.map((n: string) => n[0])
										.join("")
										.toUpperCase()}
								</AvatarFallback>
							</Avatar>
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

							<form.Field
								name="customAnnualDays"
								validators={{
									onChange: z.string().optional(),
								}}
							>
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

							<form.Field
								name="customCarryoverDays"
								validators={{
									onChange: z.string().optional(),
								}}
							>
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
										<p className="text-sm text-muted-foreground">Days carried over from previous year</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
										)}
									</div>
								)}
							</form.Field>

							<Separator />

							<div className="space-y-4">
								<h3 className="text-lg font-semibold">Manual Adjustments</h3>
								<p className="text-sm text-muted-foreground">
									Add or subtract days for special circumstances (e.g., bonus days, corrections)
								</p>

								<form.Field
									name="adjustmentDays"
									validators={{
										onChange: z.string().optional(),
									}}
								>
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

								<form.Field
									name="adjustmentReason"
									validators={{
										onChange: z.string().optional(),
									}}
								>
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
