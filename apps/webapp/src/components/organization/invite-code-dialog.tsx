"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { InviteCodeWithRelations } from "@/app/[locale]/(app)/settings/organization/invite-code-actions";
import {
	createInviteCode,
	generateRandomCode,
	updateInviteCode,
} from "@/app/[locale]/(app)/settings/organization/invite-code-actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ClientForm } from "@/components/ui/client-form";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query";

const INVITE_CODE_REGEX = /^[A-Z0-9-]{4,20}$/;

interface InviteCodeDialogProps {
	organizationId: string;
	minExpiryDate: string;
	inviteCode?: InviteCodeWithRelations | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface InviteCodeFormValues {
	code: string;
	label: string;
	description: string;
	maxUses: string;
	expiresAt: string;
	defaultTeamId: string;
	requiresApproval: boolean;
	status: "active" | "paused";
}

type InviteCodeFormApi = ReactFormExtendedApi<
	InviteCodeFormValues,
	FormValidateOrFn<InviteCodeFormValues> | undefined,
	FormValidateOrFn<InviteCodeFormValues> | undefined,
	FormAsyncValidateOrFn<InviteCodeFormValues> | undefined,
	FormValidateOrFn<InviteCodeFormValues> | undefined,
	FormAsyncValidateOrFn<InviteCodeFormValues> | undefined,
	FormValidateOrFn<InviteCodeFormValues> | undefined,
	FormAsyncValidateOrFn<InviteCodeFormValues> | undefined,
	FormValidateOrFn<InviteCodeFormValues> | undefined,
	FormAsyncValidateOrFn<InviteCodeFormValues> | undefined,
	FormAsyncValidateOrFn<InviteCodeFormValues> | undefined,
	unknown
>;

function InviteCodeFormFields({
	form,
	isEditing,
	minExpiryDate,
	teams,
	onGenerateCode,
	t,
}: {
	form: InviteCodeFormApi;
	isEditing: boolean;
	minExpiryDate: string;
	teams: Array<{ id: string; name: string }>;
	onGenerateCode: () => void;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	const validateCode = (value: string) => {
		const trimmed = value.trim();
		if (isEditing || !trimmed) return undefined;
		return INVITE_CODE_REGEX.test(trimmed)
			? undefined
			: t(
					"settings.inviteCodes.codeInvalid",
					"Use 4-20 characters: letters, numbers, and hyphens only.",
				);
	};

	const validateLabel = (value: string) =>
		value.trim() ? undefined : t("settings.inviteCodes.labelRequired", "Label is required");

	const validateMaxUses = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return undefined;
		const parsed = Number(trimmed);
		return Number.isInteger(parsed) && parsed >= 1
			? undefined
			: t("settings.inviteCodes.maxUsesInvalid", "Enter a whole number of at least 1.");
	};

	return (
		<ActionPanelBody className="space-y-5">
			<form.Field
				name="code"
				validators={{
					onSubmit: ({ value }) => validateCode(value),
					onChange: ({ value, fieldApi }) =>
						fieldApi.state.meta.errors.length > 0 ? validateCode(value) : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.inviteCodes.code", "Code")}
						</TFormLabel>
						<div className="flex flex-col gap-2 sm:flex-row">
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									name="code"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value.toUpperCase())}
									onBlur={field.handleBlur}
									placeholder={t("settings.inviteCodes.codePlaceholder", "TEAM-ABC123")}
									disabled={isEditing}
									className="font-mono uppercase tracking-[0.18em]"
								/>
							</TFormControl>
							{!isEditing && (
								<Button
									type="button"
									variant="outline"
									onClick={onGenerateCode}
									className="w-full sm:w-auto"
									aria-label={t("settings.inviteCodes.generateCode", "Generate new code")}
								>
									<IconRefresh className="size-4" aria-hidden="true" />
								</Button>
							)}
						</div>
						<TFormDescription>
							{t(
								"settings.inviteCodes.codeHelp",
								"4-20 characters, letters, numbers, and hyphens only",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<form.Field
				name="label"
				validators={{
					onSubmit: ({ value }) => validateLabel(value),
					onChange: ({ value, fieldApi }) =>
						fieldApi.state.meta.errors.length > 0 ? validateLabel(value) : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("settings.inviteCodes.label", "Label")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name="label"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"settings.inviteCodes.labelPlaceholder",
									"e.g., Public Recruitment 2024",
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
						<TFormLabel>{t("settings.inviteCodes.description", "Description")}</TFormLabel>
						<TFormControl>
							<Textarea
								name="description"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"settings.inviteCodes.descriptionPlaceholder",
									"Optional description...",
								)}
								rows={2}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>

			<form.Field
				name="maxUses"
				validators={{
					onSubmit: ({ value }) => validateMaxUses(value),
					onChange: ({ value, fieldApi }) =>
						fieldApi.state.meta.errors.length > 0 ? validateMaxUses(value) : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.inviteCodes.maxUses", "Maximum Uses")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								name="maxUses"
								type="number"
								min="1"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t("settings.inviteCodes.unlimited", "Unlimited")}
							/>
						</TFormControl>
						<TFormDescription>
							{t("settings.inviteCodes.maxUsesHelp", "Leave empty for unlimited uses")}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<form.Field name="expiresAt">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("settings.inviteCodes.expiresAt", "Expiration Date")}</TFormLabel>
						<TFormControl>
							<DatePicker
								name="expiresAt"
								value={field.state.value}
								onChange={(value) => field.handleChange(value)}
								onBlur={field.handleBlur}
								min={minExpiryDate}
							/>
						</TFormControl>
						<TFormDescription>
							{t("settings.inviteCodes.expiresAtHelp", "Leave empty for no expiration")}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>

			<form.Field name="defaultTeamId">
				{(field) => (
					<TFormItem>
						<TFormLabel>{t("settings.inviteCodes.targetTeam", "Target team")}</TFormLabel>
						<Select
							value={field.state.value || "none"}
							onValueChange={(value) => field.handleChange(value === "none" ? "" : value)}
						>
							<TFormControl>
								<SelectTrigger>
									<SelectValue placeholder={t("settings.inviteCodes.noTargetTeam", "No team")} />
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								<SelectItem value="none">
									{t("settings.inviteCodes.noTargetTeam", "No team")}
								</SelectItem>
								{teams.map((team) => (
									<SelectItem key={team.id} value={team.id}>
										{team.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TFormDescription>
							{t(
								"settings.inviteCodes.targetTeamHelp",
								"New members will use this team by default when they join.",
							)}
						</TFormDescription>
					</TFormItem>
				)}
			</form.Field>

			<form.Field name="requiresApproval">
				{(field) => (
					<div className="space-y-2">
						<div className="flex items-center gap-x-2">
							<Checkbox
								id="requiresApproval"
								checked={field.state.value}
								onCheckedChange={(checked) => field.handleChange(checked === true)}
							/>
							<Label htmlFor="requiresApproval" className="cursor-pointer">
								{t("settings.inviteCodes.requiresApproval", "Require admin approval")}
							</Label>
						</div>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.inviteCodes.requiresApprovalHelp",
								"When enabled, new members will be pending until an admin approves them",
							)}
						</p>
					</div>
				)}
			</form.Field>

			{isEditing && (
				<form.Field name="status">
					{(field) => (
						<TFormItem>
							<TFormLabel>{t("settings.inviteCodes.status", "Status")}</TFormLabel>
							<Select
								value={field.state.value}
								onValueChange={(value) => field.handleChange(value as "active" | "paused")}
							>
								<TFormControl>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									<SelectItem value="active">
										{t("settings.inviteCodes.status.active", "Active")}
									</SelectItem>
									<SelectItem value="paused">
										{t("settings.inviteCodes.status.paused", "Paused")}
									</SelectItem>
								</SelectContent>
							</Select>
						</TFormItem>
					)}
				</form.Field>
			)}
		</ActionPanelBody>
	);
}

let nextGeneratedCodeSession = 0;

// Outside the component: React Compiler cannot compile writes to module-level variables.
function allocateGeneratedCodeSession() {
	nextGeneratedCodeSession += 1;
	return nextGeneratedCodeSession;
}

export function InviteCodeDialog(props: InviteCodeDialogProps) {
	const key = `${String(props.open)}:${props.inviteCode?.id ?? "new"}`;
	return <InviteCodeDialogContent key={key} {...props} />;
}

function InviteCodeDialogContent({
	organizationId,
	minExpiryDate,
	inviteCode,
	open,
	onOpenChange,
}: InviteCodeDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!inviteCode;
	const submittingRef = useRef(false);
	const codeEditedRef = useRef(false);
	const [generatedCodeSession] = useState(allocateGeneratedCodeSession);

	// Fetch teams for team selection
	const { data: teamsResult } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: () => listTeams(),
		enabled: open,
	});

	const teams = teamsResult?.success ? teamsResult.data : [];

	const generatedCodeQuery = useQuery({
		queryKey: ["invite-code", "generated", generatedCodeSession],
		queryFn: async () => {
			const result = await generateRandomCode();
			if (!result.success) {
				throw new Error(result.error || "Failed to generate invite code");
			}
			return result.data;
		},
		enabled: open && !isEditing,
		staleTime: 0,
		gcTime: 0,
	});

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async (formValues: InviteCodeFormValues) => {
			const result = await createInviteCode({
				code: formValues.code || undefined,
				label: formValues.label.trim(),
				description: formValues.description || undefined,
				maxUses: formValues.maxUses ? parseInt(formValues.maxUses, 10) : undefined,
				expiresAt: formValues.expiresAt ? new Date(formValues.expiresAt) : undefined,
				defaultTeamId: formValues.defaultTeamId || undefined,
				requiresApproval: formValues.requiresApproval,
			});
			if (!result.success) throw new Error(result.error || "Failed to create invite code");
			return result.data;
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async (formValues: InviteCodeFormValues) => {
			const result = await updateInviteCode({
				inviteCodeId: inviteCode!.id,
				label: formValues.label.trim(),
				description: formValues.description || null,
				maxUses: formValues.maxUses ? parseInt(formValues.maxUses, 10) : null,
				expiresAt: formValues.expiresAt ? new Date(formValues.expiresAt) : null,
				defaultTeamId: formValues.defaultTeamId || null,
				requiresApproval: formValues.requiresApproval,
				status: formValues.status,
			});
			if (!result.success) throw new Error(result.error || "Failed to update invite code");
			return result.data;
		},
	});

	const form = useForm({
		defaultValues: {
			code: inviteCode?.code || "",
			label: inviteCode?.label || "",
			description: inviteCode?.description || "",
			maxUses: inviteCode?.maxUses?.toString() || "",
			expiresAt: inviteCode?.expiresAt
				? new Date(inviteCode.expiresAt).toISOString().split("T")[0]
				: "",
			defaultTeamId: inviteCode?.defaultTeamId || "",
			requiresApproval: inviteCode?.requiresApproval ?? true,
			status: inviteCode?.status === "paused" ? "paused" : "active",
		} satisfies InviteCodeFormValues,
		onSubmit: async ({ value }) => {
			if (submittingRef.current) return;
			submittingRef.current = true;

			const run = async () => {
				try {
					if (isEditing) {
						await updateMutation.mutateAsync(value);
						void queryClient.invalidateQueries({
							queryKey: queryKeys.inviteCodes.list(organizationId),
						});
						toast.success(t("settings.inviteCodes.updated", "Invite code updated"));
					} else {
						await createMutation.mutateAsync(value);
						void queryClient.invalidateQueries({
							queryKey: queryKeys.inviteCodes.list(organizationId),
						});
						toast.success(t("settings.inviteCodes.created", "Invite code created"));
					}
					onOpenChange(false);
				} catch (error) {
					toast.error(
						error instanceof Error
							? error.message
							: t("common.unexpectedError", "An unexpected error occurred"),
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

	useEffect(() => {
		if (
			!isEditing &&
			generatedCodeQuery.data &&
			!codeEditedRef.current &&
			!form.getFieldValue("code")
		) {
			form.setFieldValue("code", generatedCodeQuery.data);
		}
	}, [form, generatedCodeQuery.data, isEditing]);

	const handleGenerateCode = async () => {
		const result = await generateRandomCode().catch(() => null);
		if (result?.success) {
			codeEditedRef.current = true;
			form.setFieldValue("code", result.data);
		}
	};

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
						{isEditing
							? t("settings.inviteCodes.editCode", "Edit Invite Code")
							: t("settings.inviteCodes.createCode", "Create Invite Code")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{isEditing
							? t(
									"settings.inviteCodes.editDescription",
									"Update the settings for this invite code",
								)
							: t(
									"settings.inviteCodes.createDescription",
									"Create a new invite code for users to join your organization",
								)}
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
					<InviteCodeFormFields
						form={form}
						isEditing={isEditing}
						minExpiryDate={minExpiryDate}
						teams={teams}
						onGenerateCode={() => void handleGenerateCode()}
						t={t}
					/>

					<ActionPanelFooter>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<>
									<Button
										type="button"
										variant="outline"
										disabled={isSubmitting}
										onClick={() => handleOpenChange(false)}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting && (
											<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
										)}
										{isEditing
											? t("common.save", "Save")
											: t("settings.inviteCodes.create", "Create")}
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
