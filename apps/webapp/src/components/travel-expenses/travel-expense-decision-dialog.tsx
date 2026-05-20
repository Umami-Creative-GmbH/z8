"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	approveTravelExpenseClaim,
	rejectTravelExpenseClaim,
} from "@/app/[locale]/(app)/travel-expenses/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface TravelExpenseDecisionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	action: "approve" | "reject";
	claimId: string | null;
	onActioned?: (claimId: string) => void | Promise<void>;
}

interface DecisionFormValues {
	note: string;
	reason: string;
}

function getDefaultValues(): DecisionFormValues {
	return {
		note: "",
		reason: "",
	};
}

export function TravelExpenseDecisionDialog({
	open,
	onOpenChange,
	action,
	claimId,
	onActioned,
}: TravelExpenseDecisionDialogProps) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: getDefaultValues(),
		onSubmit: async ({ value }) => {
			if (!claimId) {
				toast.error(
					t("travelExpenses.decision.errors.missingClaim", "Travel expense claim is missing"),
				);
				return;
			}

			if (action === "reject" && !value.reason.trim()) {
				toast.error(
					t("travelExpenses.decision.errors.rejectionReason", "Please provide a rejection reason"),
				);
				return;
			}

			const result =
				action === "approve"
					? await approveTravelExpenseClaim({
							claimId,
							note: value.note.trim() || undefined,
						})
					: await rejectTravelExpenseClaim({
							claimId,
							reason: value.reason.trim(),
						});

			if (!result.success) {
				toast.error(
					result.error ||
						(action === "approve"
							? t("travelExpenses.decision.errors.approve", "Failed to approve claim")
							: t("travelExpenses.decision.errors.reject", "Failed to reject claim")),
				);
				return;
			}

			toast.success(
				action === "approve"
					? t("travelExpenses.decision.approved", "Claim approved successfully")
					: t("travelExpenses.decision.rejected", "Claim rejected successfully"),
			);
			await onActioned?.(claimId);
			onOpenChange(false);
			form.reset();
		},
	});

	useEffect(() => {
		if (!open) {
			form.reset();
		}
	}, [open, form]);

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{action === "approve"
								? t("travelExpenses.decision.approveTitle", "Approve Claim")
								: t("travelExpenses.decision.rejectTitle", "Reject Claim")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{action === "approve"
								? t(
										"travelExpenses.decision.approveDescription",
										"Add an optional note for the claimant before approving.",
									)
								: t(
										"travelExpenses.decision.rejectDescription",
										"Provide a clear reason to help the claimant update and resubmit.",
									)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="grid gap-2 py-4">
						{action === "approve" ? (
							<form.Field name="note">
								{(field) => (
									<>
										<Label htmlFor="decision-note">
											{t("travelExpenses.decision.noteOptional", "Note (optional)")}
										</Label>
										<Textarea
											id="decision-note"
											placeholder={t(
												"travelExpenses.decision.notePlaceholder",
												"Looks good. Thanks for the details.",
											)}
											rows={4}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</>
								)}
							</form.Field>
						) : (
							<form.Field name="reason">
								{(field) => (
									<>
										<Label htmlFor="decision-reason">
											{t("travelExpenses.decision.reasonRequired", "Reason (required)")}
										</Label>
										<Textarea
											id="decision-reason"
											placeholder={t(
												"travelExpenses.decision.reasonPlaceholder",
												"Missing receipt details for the submitted amount",
											)}
											rows={4}
											required
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
										/>
									</>
								)}
							</form.Field>
						)}
					</ActionPanelBody>

					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<ActionPanelFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => onOpenChange(false)}
									disabled={isSubmitting}
								>
									{t("common.cancel", "Cancel")}
								</Button>
								<Button
									type="submit"
									variant={action === "approve" ? "default" : "destructive"}
									disabled={isSubmitting}
								>
									{isSubmitting && (
										<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
									)}
									{action === "approve" ? (
										<>
											<IconCheck className="mr-2 size-4" aria-hidden="true" />
											{t("travelExpenses.decision.approve", "Approve")}
										</>
									) : (
										<>
											<IconX className="mr-2 size-4" aria-hidden="true" />
											{t("travelExpenses.decision.reject", "Reject")}
										</>
									)}
								</Button>
							</ActionPanelFooter>
						)}
					</form.Subscribe>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
