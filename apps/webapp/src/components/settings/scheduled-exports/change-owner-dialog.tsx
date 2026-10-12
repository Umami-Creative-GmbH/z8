"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import useSWR from "swr";
import {
	changeScheduledExportOwnerAction,
	getScheduleOwnerCandidatesAction,
	type ScheduledExportSummary,
} from "@/app/[locale]/(app)/settings/scheduled-exports/actions";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";

interface ChangeOwnerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	schedule: ScheduledExportSummary;
	onSuccess: () => void;
}

/** Hands a scheduled export to another org admin (#988). */
export function ChangeOwnerDialog({
	open,
	onOpenChange,
	organizationId,
	schedule,
	onSuccess,
}: ChangeOwnerDialogProps) {
	const { t } = useTranslate();
	const { data: candidates, isLoading } = useSWR(
		open ? ["scheduled-export-owner-candidates", organizationId] : null,
		async () => {
			const result = await getScheduleOwnerCandidatesAction(organizationId);
			if (result.success) return result.data;
			throw new Error(result.error);
		},
		{ revalidateOnFocus: false },
	);

	const form = useForm({
		defaultValues: { ownerId: schedule.ownerEligible ? schedule.ownerId : "" },
		onSubmit: async ({ value }) => {
			const result = await changeScheduledExportOwnerAction(
				organizationId,
				schedule.id,
				value.ownerId,
			).catch(() => null);
			if (!result?.success) {
				toast.error(
					t("settings.scheduledExports.owner.changeFailed", "Couldn't change the owner"),
					{ description: result?.error },
				);
				return;
			}
			toast.success(t("settings.scheduledExports.owner.changed", "Owner changed"));
			onOpenChange(false);
			onSuccess();
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<form
					className="flex min-h-0 flex-1 flex-col"
					action={() => {
						void form.handleSubmit();
					}}
					onSubmit={(event) => {
						event.stopPropagation();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.scheduledExports.owner.title", "Change owner")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.scheduledExports.owner.description",
								'"{name}" runs on behalf of its owner, who must be an org admin. Automated runs are recorded in the audit log under the owner.',
								{ name: schedule.name },
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-5">
						<form.Field
							name="ownerId"
							validators={{
								onChange: ({ value }) =>
									value
										? undefined
										: t("settings.scheduledExports.owner.required", "Choose an org admin"),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.scheduledExports.owner.label", "Owner")}
									</TFormLabel>
									<Select
										name="ownerId"
										value={field.state.value}
										onValueChange={(value) => field.handleChange(value)}
										disabled={isLoading}
									>
										<TFormControl hasError={fieldHasError(field)}>
											<SelectTrigger className="w-full" onBlur={field.handleBlur}>
												<SelectValue
													placeholder={t(
														"settings.scheduledExports.owner.placeholder",
														"Select an org admin…",
													)}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{(candidates ?? []).map((candidate) => (
												<SelectItem key={candidate.userId} value={candidate.userId}>
													{candidate.name || candidate.email || candidate.userId}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.scheduledExports.owner.pauseNote",
								"Changing the owner doesn't resume a paused schedule. Turn it back on once it has an owner.",
							)}
						</p>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<Button type="submit" disabled={isSubmitting || isLoading}>
									{isSubmitting ? (
										<>
											<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
											{t("settings.scheduledExports.owner.saving", "Saving…")}
										</>
									) : (
										t("settings.scheduledExports.owner.submit", "Change owner")
									)}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
