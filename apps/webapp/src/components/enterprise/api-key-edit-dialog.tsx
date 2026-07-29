"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { toast } from "sonner";
import { updateApiKey } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	API_KEY_SCOPES,
	type ApiKeyResponse,
	type ApiKeyScope,
	SCOPE_LABELS,
} from "@/lib/validations/api-key";

interface ApiKeyEditDialogProps {
	organizationId: string;
	apiKey: ApiKeyResponse | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

type ApiKeyEditDialogFormProps = Omit<ApiKeyEditDialogProps, "apiKey"> & {
	apiKey: ApiKeyResponse;
};

type ApiKeyEditFormValues = {
	name: string;
	enabled: boolean;
	scopes: ApiKeyScope[];
	rateLimitEnabled: boolean;
	rateLimitMax: string;
};

type ApiKeyEditMutationVariables = {
	keyId: string;
	value: ApiKeyEditFormValues;
};

type ValidationMessages = {
	nameMin: string;
	nameMax: string;
	scopesRequired: string;
	rateLimitRequired: string;
	rateLimitWholeNumber: string;
	rateLimitMin: string;
	rateLimitMax: string;
};

function getValidationMessages(
	t: ReturnType<typeof useTranslate>["t"],
): ValidationMessages {
	return {
		nameMin: t(
			"settings.apiKeys.form.nameMin",
			"Name must be at least 3 characters",
		),
		nameMax: t(
			"settings.apiKeys.form.nameMax",
			"Name must be at most 100 characters",
		),
		scopesRequired: t(
			"settings.apiKeys.form.scopesRequired",
			"Select at least one permission",
		),
		rateLimitRequired: t(
			"settings.apiKeys.form.rateLimitRequired",
			"Rate limit is required",
		),
		rateLimitWholeNumber: t(
			"settings.apiKeys.form.rateLimitWholeNumber",
			"Rate limit must be a whole number",
		),
		rateLimitMin: t(
			"settings.apiKeys.form.rateLimitMin",
			"Rate limit must be at least 10 requests",
		),
		rateLimitMax: t(
			"settings.apiKeys.form.rateLimitMaxExceeded",
			"Rate limit must be at most 10,000 requests",
		),
	};
}

function validateName(value: string, messages: ValidationMessages) {
	const trimmedValue = value.trim();
	if (trimmedValue.length < 3) return messages.nameMin;
	if (trimmedValue.length > 100) return messages.nameMax;
	return undefined;
}

function validateScopes(value: ApiKeyScope[], messages: ValidationMessages) {
	return value.length > 0 ? undefined : messages.scopesRequired;
}

function validateRateLimit(value: string, messages: ValidationMessages) {
	if (value.length === 0) return messages.rateLimitRequired;
	const rateLimit = Number(value);
	if (!Number.isInteger(rateLimit)) return messages.rateLimitWholeNumber;
	if (rateLimit < 10) return messages.rateLimitMin;
	if (rateLimit > 10000) return messages.rateLimitMax;
	return undefined;
}

function validateForm(
	value: ApiKeyEditFormValues,
	messages: ValidationMessages,
) {
	return validateName(value.name, messages) === undefined &&
		validateScopes(value.scopes, messages) === undefined &&
		validateRateLimit(value.rateLimitMax, messages) === undefined
		? undefined
		: "Invalid API key form";
}

function getValidDefaultRateLimit(value: string) {
	const rateLimit = Number(value);
	return value.length > 0 &&
		Number.isInteger(rateLimit) &&
		rateLimit >= 10 &&
		rateLimit <= 10000
		? value
		: "100";
}

function getApiKeyEditDefaultValues(
	apiKey: ApiKeyResponse,
): ApiKeyEditFormValues {
	return {
		name: apiKey.name,
		enabled: apiKey.enabled,
		scopes: apiKey.scopes,
		rateLimitEnabled: apiKey.rateLimitEnabled ?? true,
		rateLimitMax: String(apiKey.rateLimitMax || 100),
	};
}

function ApiKeyIdentifier({ apiKey }: { apiKey: ApiKeyResponse }) {
	const { t } = useTranslate();
	return (
		<div className="flex items-center gap-3 p-3 bg-muted rounded-md">
			<code className="font-mono text-sm">{apiKey.prefix || "z8_org_***"}</code>
			<span className="text-muted-foreground text-sm">
				{t("settings.apiKeys.editCreated", "Created {date}", {
					date: DateTime.fromISO(apiKey.createdAt).toLocaleString(
						DateTime.DATE_SHORT,
					),
				})}
			</span>
		</div>
	);
}

export function ApiKeyEditDialog({ apiKey, ...props }: ApiKeyEditDialogProps) {
	if (!apiKey) return null;

	return <ApiKeyEditDialogForm key={apiKey.id} {...props} apiKey={apiKey} />;
}

function ApiKeyEditDialogForm({
	organizationId,
	apiKey,
	open,
	onOpenChange,
}: ApiKeyEditDialogFormProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const formDefaultValues = getApiKeyEditDefaultValues(apiKey);
	const validationMessages = getValidationMessages(t);
	const updateMutation = useMutation({
		mutationFn: async ({ keyId, value }: ApiKeyEditMutationVariables) => {
			const result = await updateApiKey(organizationId, keyId, {
				name: value.name.trim(),
				enabled: value.enabled,
				scopes: value.scopes,
				rateLimitEnabled: value.rateLimitEnabled,
				rateLimitMax: Number(value.rateLimitMax),
			});
			if (!result.success)
				throw new Error(result.error || "Failed to update API key");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ["apiKeys", organizationId] });
			toast.success(t("settings.apiKeys.updated", "API key updated"));
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: formDefaultValues,
		validators: {
			onMount: ({ value }) => validateForm(value, validationMessages),
			onChange: ({ value }) => validateForm(value, validationMessages),
			onSubmit: ({ value }) => validateForm(value, validationMessages),
		},
		onSubmit: ({ value }) =>
			updateMutation.mutate(
				{ keyId: apiKey.id, value },
				{ onSuccess: () => onOpenChange(false) },
			),
	});
	const handleOpenChange = (nextOpen: boolean) => {
		if (!nextOpen && updateMutation.isPending) return;
		if (!nextOpen) form.reset(formDefaultValues);
		onOpenChange(nextOpen);
	};
	const preventPendingDismiss = (event: Event) => {
		if (updateMutation.isPending) event.preventDefault();
	};
	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				onEscapeKeyDown={preventPendingDismiss}
				onInteractOutside={preventPendingDismiss}
				onPointerDownOutside={preventPendingDismiss}
				showCloseButton={!updateMutation.isPending}
			>
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
							{t("settings.apiKeys.editTitle", "Edit API Key")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.apiKeys.editDescription",
								"Update the settings for this API key. Note: You cannot view or change the key itself.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody className="space-y-4">
						<ApiKeyIdentifier apiKey={apiKey} />
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }) =>
									validateName(value, validationMessages),
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)} required>
										{t("settings.apiKeys.form.name", "Name")}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											name="apiKeyName"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
											maxLength={100}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field name="enabled">
							{(field) => (
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label>
											{t("settings.apiKeys.form.enabled", "Key Enabled")}
										</Label>
										<p className="text-xs text-muted-foreground">
											{t(
												"settings.apiKeys.form.enabledHelp",
												"Disabled keys will reject all API requests",
											)}
										</p>
									</div>
									<Switch
										id="edit-enabled"
										checked={field.state.value}
										onCheckedChange={field.handleChange}
										aria-label={t(
											"settings.apiKeys.form.enabled",
											"Key Enabled",
										)}
									/>
								</div>
							)}
						</form.Field>
						<form.Field
							name="scopes"
							validators={{
								onChange: ({ value }) =>
									validateScopes(value, validationMessages),
							}}
						>
							{(field) => (
								<TFormItem>
									<fieldset
										aria-invalid={fieldHasError(field)}
										aria-describedby={
											fieldHasError(field) ? "edit-scopes-error" : undefined
										}
									>
										<legend
											className={
												fieldHasError(field)
													? "mb-2 font-medium text-destructive text-sm"
													: "mb-2 font-medium text-sm"
											}
										>
											{t("settings.apiKeys.form.scopes", "Permissions")}
											<span className="ml-1 text-destructive">*</span>
										</legend>
										<div className="grid grid-cols-2 gap-2 p-3 border rounded-md bg-muted/30">
											{API_KEY_SCOPES.map((scope) => (
												<div key={scope} className="flex items-center gap-x-2">
													<Checkbox
														id={`edit-${scope}`}
														checked={field.state.value.includes(scope)}
														onCheckedChange={() =>
															field.handleChange(
																field.state.value.includes(scope)
																	? field.state.value.filter(
																			(selectedScope) =>
																				selectedScope !== scope,
																		)
																	: [...field.state.value, scope],
															)
														}
													/>
													<Label
														htmlFor={`edit-${scope}`}
														className="text-sm font-normal cursor-pointer"
													>
														{t(
															`settings.apiKeys.scope.${scope}`,
															SCOPE_LABELS[scope],
														)}
													</Label>
												</div>
											))}
										</div>
									</fieldset>
									<TFormMessage
										id="edit-scopes-error"
										field={field}
										className="text-xs"
									/>
								</TFormItem>
							)}
						</form.Field>
						<div className="space-y-3">
							<form.Field name="rateLimitEnabled">
								{(field) => (
									<div className="flex items-center gap-x-2">
										<Checkbox
											id="edit-rateLimitEnabled"
											checked={field.state.value}
											onCheckedChange={(checked) => {
												const enabled = checked === true;
												field.handleChange(enabled);
												if (!enabled) {
													form.setFieldValue(
														"rateLimitMax",
														getValidDefaultRateLimit(
															formDefaultValues.rateLimitMax,
														),
													);
												}
											}}
										/>
										<Label
											htmlFor="edit-rateLimitEnabled"
											className="font-normal cursor-pointer"
										>
											{t(
												"settings.apiKeys.form.rateLimit",
												"Enable rate limiting",
											)}
										</Label>
									</div>
								)}
							</form.Field>
							<form.Subscribe<boolean>
								selector={(state) => state.values.rateLimitEnabled}
							>
								{(rateLimitEnabled: boolean) =>
									rateLimitEnabled ? (
										<form.Field
											name="rateLimitMax"
											validators={{
												onChange: ({ value }) =>
													validateRateLimit(value, validationMessages),
											}}
										>
											{(field) => (
												<TFormItem className="ml-6">
													<TFormLabel hasError={fieldHasError(field)}>
														{t(
															"settings.apiKeys.form.rateLimitMax",
															"Max requests per minute",
														)}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															name="rateLimitMax"
															type="number"
															step={1}
															value={field.state.value}
															onChange={(event) =>
																field.handleChange(event.target.value)
															}
															onBlur={field.handleBlur}
															min={10}
															max={10000}
															className="w-32"
														/>
													</TFormControl>
													<TFormMessage field={field} className="text-xs" />
												</TFormItem>
											)}
										</form.Field>
									) : null
								}
							</form.Subscribe>
						</div>
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							disabled={updateMutation.isPending}
							onClick={() => handleOpenChange(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe<[boolean, boolean]>
							selector={(state) => [state.canSubmit, updateMutation.isPending]}
						>
							{([isValid, isPending]: [boolean, boolean]) => (
								<Button type="submit" disabled={!isValid || isPending}>
									{isPending && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
									{t("common.save", "Save")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
