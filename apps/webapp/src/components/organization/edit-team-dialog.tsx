"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { toast } from "sonner";
import { updateTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import { EmployeeSingleSelect, toSelectableEmployee } from "@/components/employee-select";
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
import { ClientForm } from "@/components/ui/client-form";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { team } from "@/db/schema";
import { queryKeys } from "@/lib/query";
import type { TeamManagerOption } from "./create-team-dialog";

const NO_MANAGER_VALUE = "none";

type TeamRecord = typeof team.$inferSelect;

interface EditTeamDialogProps {
	team: TeamRecord | null;
	managerOptions: TeamManagerOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (updatedTeam: TeamRecord) => void;
}

interface EditTeamFormValues {
	name: string;
	description: string;
	primaryManagerId: string;
}

export function EditTeamDialog(props: EditTeamDialogProps) {
	if (!props.team) return null;
	return (
		<EditTeamDialogContent
			key={`${props.team.id}:${String(props.open)}`}
			{...props}
			team={props.team}
		/>
	);
}

function EditTeamDialogContent({
	team,
	managerOptions,
	open,
	onOpenChange,
	onSuccess,
}: Omit<EditTeamDialogProps, "team"> & { team: TeamRecord }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const submittingRef = useRef(false);

	const updateMutation = useMutation({
		mutationFn: (data: {
			teamId: string;
			name?: string;
			description?: string;
			primaryManagerId?: string | null;
		}) =>
			updateTeam({
				teamId: data.teamId,
				name: data.name,
				description: data.description,
				primaryManagerId: data.primaryManagerId,
			}),
	});

	const validateName = (value: string) =>
		value.trim()
			? undefined
			: t("settings.organization.teams.createDialog.nameRequired", "Team name is required");

	const form = useForm({
		defaultValues: {
			name: team.name,
			description: team.description || "",
			primaryManagerId: team.primaryManagerId ?? NO_MANAGER_VALUE,
		} satisfies EditTeamFormValues,
		onSubmit: async ({ value }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					const trimmedName = value.name.trim();
					const trimmedDescription = value.description.trim();
					const primaryManagerId =
						value.primaryManagerId === NO_MANAGER_VALUE ? null : value.primaryManagerId;

					const result = await updateMutation.mutateAsync({
						teamId: team.id,
						name: trimmedName !== team.name ? trimmedName : undefined,
						description:
							trimmedDescription !== (team.description || "") ? trimmedDescription : undefined,
						primaryManagerId:
							primaryManagerId !== team.primaryManagerId ? primaryManagerId : undefined,
					});

					if (!result.success) {
						toast.error(
							result.error || t("organization.teams.edit.updateError", "Failed to update team"),
						);
						return;
					}
					void Promise.all([
						queryClient.invalidateQueries({
							queryKey: queryKeys.teams.list(result.data.organizationId),
						}),
						queryClient.invalidateQueries({ queryKey: queryKeys.teams.detail(result.data.id) }),
					]);
					toast.success(t("organization.teams.edit.updateSuccess", "Team updated successfully"));
					onOpenChange(false);
					onSuccess?.(result.data);
				} catch {
					toast.error(t("organization.teams.edit.updateError", "Failed to update team"));
				}
			};

			// Promise#finally rather than try/finally: the React Compiler cannot
			// compile try statements without a catch clause.
			await run().finally(() => {
				submittingRef.current = false;
			});
		},
	});

	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && submittingRef.current) return;
		onOpenChange(nextOpen);
	};

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				onEscapeKeyDown={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (submittingRef.current) event.preventDefault();
				}}
			>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("organization.teams.edit.title", "Edit Team")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t("organization.teams.edit.description", "Update team name and description")}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ClientForm
					noValidate
					onSubmit={() => {
						if (submittingRef.current) return;
						void form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						<form.Field
							name="name"
							validators={{
								onSubmit: ({ value }) => validateName(value),
								onChange: ({ value, fieldApi }) =>
									fieldApi.state.meta.errors.length > 0 ? validateName(value) : undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("organization.teams.edit.nameLabel", "Team Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"organization.teams.edit.namePlaceholder",
												"Engineering, Sales, Marketing...",
											)}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="description">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("organization.teams.edit.descriptionLabel", "Description (Optional)")}
									</TFormLabel>
									<TFormControl>
										<Textarea
											name="description"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"organization.teams.edit.descriptionPlaceholder",
												"A brief description of this team",
											)}
											rows={3}
										/>
									</TFormControl>
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="primaryManagerId">
							{(field) => (
								<div className="space-y-2">
									<EmployeeSingleSelect
										id="primaryManagerId"
										label={t("organization.teams.edit.fallbackManagerLabel", "Fallback Manager")}
										placeholder={t(
											"organization.teams.edit.noFallbackManager",
											"No fallback manager",
										)}
										allowClear
										clearLabel={t(
											"organization.teams.edit.noFallbackManager",
											"No fallback manager",
										)}
										value={field.state.value === NO_MANAGER_VALUE ? null : field.state.value}
										onChange={(value) => field.handleChange(value ?? NO_MANAGER_VALUE)}
										employees={managerOptions.map((manager) =>
											toSelectableEmployee({
												id: manager.employeeId,
												name: manager.name,
												email: manager.email,
												position: manager.position,
												role: "manager",
											}),
										)}
									/>
									<p className="text-xs text-muted-foreground">
										{t(
											"organization.teams.edit.fallbackManagerHelp",
											"Used for approvals when a team member has no direct manager.",
										)}
									</p>
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<>
									<Button
										type="button"
										variant="outline"
										onClick={() => handleOpenChange(false)}
										disabled={isSubmitting}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting && (
											<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
										)}
										{t("common.saveChanges", "Save Changes")}
									</Button>
								</>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</ClientForm>
			</ActionPanelContent>
		</ActionPanel>
	);
}
