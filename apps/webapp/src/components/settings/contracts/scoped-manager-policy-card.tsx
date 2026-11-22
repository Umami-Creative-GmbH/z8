"use client";

import { IconCheck, IconGavel, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { assignEmployeeWorkPolicyAction } from "@/app/[locale]/(app)/settings/contracts/actions";
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
import { todayIsoDateInTimezone } from "./contract-formatters";

export interface ScopedManagerPolicyCardProps {
	employeeId: string;
	organizationTimezone: string;
	workPolicies: readonly { id: string; name: string }[];
	onAssigned?: () => void;
}

/**
 * A1 Wage-Free Work Policy Assignment Surface for scoped managers:
 * allows assigning a work policy to a managed employee without exposing wages,
 * employment terms, org/team defaults, templates, or leaving dates.
 */
export function ScopedManagerPolicyCard({
	employeeId,
	organizationTimezone,
	workPolicies,
	onAssigned,
}: ScopedManagerPolicyCardProps) {
	const { t } = useTranslate();
	const orgTodayDate = todayIsoDateInTimezone(organizationTimezone);

	const assignMutation = useMutation({
		mutationFn: async (values: { policyId: string; effectiveFromDate: string }) => {
			const result = await assignEmployeeWorkPolicyAction({
				employeeId,
				policyId: values.policyId,
				effectiveFromDate: values.effectiveFromDate || undefined,
			});
			if (!result.success) {
				throw new Error(result.error || "Could not assign work policy");
			}
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.scopedManager.assignedSuccess", "Work policy assigned"));
			onAssigned?.();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.scopedManager.assignFailed", "Could not assign work policy"),
			);
		},
	});

	const form = useForm({
		defaultValues: {
			policyId: workPolicies[0]?.id ?? "",
			effectiveFromDate: orgTodayDate,
		},
		onSubmit: async ({ value }) => {
			if (!value.policyId) {
				toast.error(
					t("settings.contracts.scopedManager.policyRequired", "Choose a work policy to assign."),
				);
				return;
			}
			await assignMutation.mutateAsync(value);
		},
	});

	return (
		<Card id="employment-history">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconGavel className="size-5" aria-hidden="true" />
					{t("settings.contracts.scopedManager.title", "Work Policy Assignment")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.scopedManager.description",
						"Assign a work policy to this managed employee. Contract terms, wages, and organization defaults are managed by organization admins.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{workPolicies.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						{t(
							"settings.contracts.scopedManager.noPolicies",
							"No active work policies are available to assign.",
						)}
					</p>
				) : (
					<form
						className="grid gap-4 sm:grid-cols-3 sm:items-end"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void form.handleSubmit();
						}}
					>
						<form.Field name="policyId">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="scoped-manager-policy">
										{t("settings.contracts.fields.workPolicy", "Work policy")}
									</Label>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger id="scoped-manager-policy">
											<SelectValue
												placeholder={t(
													"settings.contracts.scopedManager.selectPolicy",
													"Select work policy",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{workPolicies.map((policy) => (
												<SelectItem key={policy.id} value={policy.id}>
													{policy.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						<form.Field name="effectiveFromDate">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="scoped-manager-effective-from">
										{t("settings.contracts.defaults.effectiveFrom", "Effective from")}
									</Label>
									<Input
										id="scoped-manager-effective-from"
										type="date"
										min={orgTodayDate}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</form.Field>

						<Button type="submit" disabled={assignMutation.isPending}>
							{assignMutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.scopedManager.assignButton", "Assign work policy")}
						</Button>
					</form>
				)}
			</CardContent>
		</Card>
	);
}
