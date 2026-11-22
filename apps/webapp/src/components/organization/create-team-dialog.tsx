"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { toast } from "sonner";
import { createTeam } from "@/app/[locale]/(app)/settings/teams/actions";
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

const NO_MANAGER_VALUE = "none";

export interface TeamManagerOption {
	employeeId: string;
	name: string;
	email: string;
	position?: string | null;
}

interface CreateTeamDialogProps {
	organizationId: string;
	managerOptions: TeamManagerOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (createdTeam: typeof team.$inferSelect) => void;
}

interface CreateTeamFormValues {
	name: string;
	description: string;
	primaryManagerId: string;
}

export function CreateTeamDialog(props: CreateTeamDialogProps) {
	return <CreateTeamDialogContent key={String(props.open)} {...props} />;
}

function CreateTeamDialogContent({
	organizationId,
	managerOptions,
	open,
	onOpenChange,
	onSuccess,
}: CreateTeamDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const submittingRef = useRef(false);

	const createMutation = useMutation({
		mutationFn: (data: { name: string; description?: string; primaryManagerId?: string | null }) =>
			createTeam(data),
	});

	const validateName = (value: string) =>
		value.trim()
			? undefined
			: t("settings.organization.teams.createDialog.nameRequired", "Team name is required");

	const form = useForm({
		defaultValues: {
			name: "",
			description: "",
			primaryManagerId: NO_MANAGER_VALUE,
		} satisfies CreateTeamFormValues,
		onSubmit: async ({ value, formApi }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					const result = await createMutation.mutateAsync({
						name: value.name.trim(),
						description: value.description.trim() || undefined,
						primaryManagerId:
							value.primaryManagerId === NO_MANAGER_VALUE ? null : value.primaryManagerId,
					});
					if (!result.success) {
						toast.error(
							result.error ||
								t("settings.organization.teams.createDialog.createFailed", "Failed to create team"),
						);
						return;
					}
					toast.success(
						t(
							"settings.organization.teams.createDialog.createSuccess",
							"Team created successfully",
						),
					);
					void queryClient.invalidateQueries({ queryKey: queryKeys.teams.list(organizationId) });
					formApi.reset();
					onOpenChange(false);
					onSuccess?.(result.data);
				} catch {
					toast.error(
						t("settings.organization.teams.createDialog.createFailed", "Failed to create team"),
					);
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
					<ActionPanelTitle>
						{t("settings.organization.teams.createDialog.title", "Create Team")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.organization.teams.createDialog.description",
							"Create a new team to organize your employees",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ClientForm
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					onSubmit={() => {
						if (submittingRef.current) return;
						void form.handleSubmit();
					}}
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
										{t("settings.organization.teams.createDialog.nameLabel", "Team Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="name"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.organization.teams.createDialog.namePlaceholder",
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
										{t(
											"settings.organization.teams.createDialog.descriptionLabel",
											"Description (Optional)",
										)}
									</TFormLabel>
									<TFormControl>
										<Textarea
											name="description"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.organization.teams.createDialog.descriptionPlaceholder",
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
										id="primary-manager"
										label={t(
											"settings.organization.teams.createDialog.fallbackManagerLabel",
											"Fallback Manager",
										)}
										placeholder={t(
											"settings.organization.teams.createDialog.noFallbackManager",
											"No fallback manager",
										)}
										allowClear
										clearLabel={t(
											"settings.organization.teams.createDialog.noFallbackManager",
											"No fallback manager",
										)}
										value={field.state.value === NO_MANAGER_VALUE ? null : field.state.value}
										onChange={(primaryManagerId) =>
											field.handleChange(primaryManagerId ?? NO_MANAGER_VALUE)
										}
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
											"settings.organization.teams.createDialog.fallbackManagerHelp",
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
										{t("common:common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting && (
											<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
										)}
										{t("settings.organization.teams.createDialog.submit", "Create Team")}
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
