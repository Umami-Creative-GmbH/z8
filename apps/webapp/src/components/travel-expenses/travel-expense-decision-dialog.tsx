"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	approveTravelExpenseClaim,
	rejectTravelExpenseClaim,
} from "@/app/[locale]/(app)/travel-expenses/actions";
import { Button } from "@/components/ui/button";
import {
	ActionPanel,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
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
	const form = useForm({
		defaultValues: getDefaultValues(),
		onSubmit: async ({ value }) => {
			if (!claimId) {
				toast.error("Travel expense claim is missing");
				return;
			}

			if (action === "reject" && !value.reason.trim()) {
				toast.error("Please provide a rejection reason");
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
				toast.error(result.error || `Failed to ${action} claim`);
				return;
			}

			toast.success(`Claim ${action}d successfully`);
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
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>{action === "approve" ? "Approve Claim" : "Reject Claim"}</ActionPanelTitle>
						<ActionPanelDescription>
							{action === "approve"
								? "Add an optional note for the claimant before approving."
								: "Provide a clear reason to help the claimant update and resubmit."}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<div className="grid gap-2 py-4">
						{action === "approve" ? (
							<form.Field name="note">
								{(field) => (
									<>
										<Label htmlFor="decision-note">Note (optional)</Label>
										<Textarea
											id="decision-note"
											placeholder="Looks good. Thanks for the details."
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
										<Label htmlFor="decision-reason">Reason (required)</Label>
										<Textarea
											id="decision-reason"
											placeholder="Missing receipt details for the submitted amount"
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
					</div>

					<form.Subscribe selector={(state) => state.isSubmitting}>
						{(isSubmitting) => (
							<ActionPanelFooter>
								<Button
									type="button"
									variant="outline"
									onClick={() => onOpenChange(false)}
									disabled={isSubmitting}
								>
									Cancel
								</Button>
								<Button
									type="submit"
									variant={action === "approve" ? "default" : "destructive"}
									disabled={isSubmitting}
								>
									{isSubmitting && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{action === "approve" ? (
										<>
											<IconCheck className="mr-2 size-4" />
											Approve
										</>
									) : (
										<>
											<IconX className="mr-2 size-4" />
											Reject
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
