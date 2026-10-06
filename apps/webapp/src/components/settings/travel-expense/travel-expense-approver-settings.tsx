"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	getTravelExpenseApproverSettings,
	saveTravelExpenseApprover,
	type TravelExpenseApproverSettings,
} from "@/app/[locale]/(app)/settings/travel-expenses/approver-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query/keys";

const NONE = "none";
const queryKey = queryKeys.travelExpenses.approverSettings();

function ApproverForm({ settings }: { settings: TravelExpenseApproverSettings }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const form = useForm({
		defaultValues: { approver: settings.expenseApproverEmployeeId ?? NONE },
		onSubmit: async ({ value }) => {
			const result = await saveTravelExpenseApprover({
				expenseApproverEmployeeId: value.approver === NONE ? null : value.approver,
			});
			if (!result.success) {
				toast.error(
					result.error ||
						t("settings.travelExpenses.approver.saveFailed", "Failed to save the expense approver"),
				);
				return;
			}
			await queryClient.invalidateQueries({ queryKey });
			toast.success(t("settings.travelExpenses.approver.saved", "Expense approver saved"));
		},
	});

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field name="approver">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.travelExpenses.approver.label", "Expense approver")}
						</TFormLabel>
						<Select
							value={field.state.value}
							onValueChange={(value) => field.handleChange(value ?? NONE)}
						>
							<TFormControl>
								<SelectTrigger className="w-full sm:w-80">
									<SelectValue />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value={NONE}>
									{t("settings.travelExpenses.approver.none", "No expense approver")}
								</SelectItem>
								{settings.candidates.map((candidate) => (
									<SelectItem key={candidate.id} value={candidate.id}>
										{candidate.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TFormDescription>
							{t(
								"settings.travelExpenses.approver.description",
								"Reviews expense reports of employees who have no manager or team manager other than themselves. Only active managers and administrators can review in the Approvals inbox. Nobody ever reviews their own report.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting && (
							<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
						)}
						{t("settings.travelExpenses.approver.save", "Save approver")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

/**
 * Organization expense approver (#602): the last fallback after the direct
 * manager and the team manager when routing a submitted expense report.
 */
export function TravelExpenseApproverSettingsCard() {
	const { t } = useTranslate();
	const { data, isLoading, isError, refetch } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getTravelExpenseApproverSettings();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.travelExpenses.approver.title", "Expense report review")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.travelExpenses.approver.intro",
						"Submitted expense reports go to the employee's direct manager, then their team manager, then the expense approver chosen here.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading && <Skeleton aria-hidden="true" className="h-20 w-full" />}
				{isError && (
					<div className="space-y-2">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.travelExpenses.approver.loadFailed",
								"The expense approver could not be loaded.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{data && <ApproverForm key={data.expenseApproverEmployeeId ?? NONE} settings={data} />}
			</CardContent>
		</Card>
	);
}
