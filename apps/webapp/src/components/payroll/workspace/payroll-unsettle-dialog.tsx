"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { toast } from "sonner";
import { unsettlePayrollDaysAction } from "@/app/[locale]/(app)/payroll/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { UnsettleReasonInput } from "./unsettle-reason-input";
import { usePayrollSettlementChanged } from "./use-payroll-settlement-changed";

/**
 * Unsettles every settled day of a range and employee selection (#1896), with a
 * required reason the history keeps.
 */
export function PayrollUnsettleDialog({
	open,
	onOpenChange,
	request,
	settledDays,
	t,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The range (`startDate`–`endDate`) and employees whose settled days to unsettle. */
	request: PayrollPeriodRequest;
	settledDays: number;
	t: PayrollTranslate;
}) {
	const settlementChanged = usePayrollSettlementChanged();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			const result = await unsettlePayrollDaysAction({ ...request, reason: value.reason });
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t("payroll.settle.unsettled", "{count} days unsettled", {
					count: result.data.unsettledDays,
				}),
			);
			form.reset();
			onOpenChange(false);
			await settlementChanged();
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<form className="flex flex-col gap-4" action={() => form.handleSubmit()}>
					<DialogHeader>
						<DialogTitle>{t("payroll.settle.unsettleTitle", "Unsettle days?")}</DialogTitle>
						<DialogDescription>
							{t(
								"payroll.settle.unsettleDescription",
								"The {count} settled days of {period} in this selection become unsettled, so a later payroll file can carry them again. The settlement history keeps what was paid.",
								{ count: settledDays, period: request.label },
							)}
						</DialogDescription>
					</DialogHeader>
					<form.Field
						name="reason"
						validators={{
							onSubmit: ({ value }) =>
								value.trim()
									? undefined
									: t("payroll.settle.reasonRequired", "A reason is required to unsettle days"),
						}}
					>
						{(field) => <UnsettleReasonInput field={field} t={t} />}
					</form.Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("payroll.settle.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
									) : null}
									{t("payroll.settle.unsettleConfirm", "Unsettle days")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
