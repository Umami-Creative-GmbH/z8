"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { createApiKey } from "@/app/[locale]/(app)/settings/enterprise/api-keys/actions";
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
import {
	API_KEY_SCOPES,
	type ApiKeyScope,
	type CreateApiKeyResponse,
	EXPIRATION_OPTIONS,
	SCOPE_LABELS,
} from "@/lib/validations/api-key";

export interface ApiKeyCreateDialogProps {
	organizationId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onKeyCreated: (key: CreateApiKeyResponse) => void;
}

type ExpirationValue = (typeof EXPIRATION_OPTIONS)[number]["value"];

interface ApiKeyCreateFormValues {
	name: string;
	expiresIn: ExpirationValue;
	selectedScopes: ApiKeyScope[];
	rateLimitEnabled: boolean;
	rateLimitMax: string;
}

const DEFAULT_FORM_VALUES: ApiKeyCreateFormValues = {
	name: "",
	expiresIn: "30",
	selectedScopes: ["time-entries:read"],
	rateLimitEnabled: true,
	rateLimitMax: "100",
};

function isRateLimitMaxValid(value: string) {
	const parsedValue = Number(value);
	return (
		value.trim() !== "" &&
		Number.isInteger(parsedValue) &&
		parsedValue >= 10 &&
		parsedValue <= 10000
	);
}

function isNameValid(value: string) {
	return value.trim().length >= 3;
}

function validateForm(value: ApiKeyCreateFormValues, message: string) {
	return isNameValid(value.name) &&
		value.selectedScopes.length > 0 &&
		(!value.rateLimitEnabled || isRateLimitMaxValid(value.rateLimitMax))
		? undefined
		: message;
}

function validateRateLimitMax(value: string, message: string) {
	return isRateLimitMaxValid(value) ? undefined : message;
}

function useApiKeyCreateController({
	organizationId,
	onOpenChange,
	onKeyCreated,
}: ApiKeyCreateDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const invalidFormMessage = t(
		"settings.apiKeys.form.invalid",
		"Review the invalid form fields",
	);
	const nameMinLengthMessage = t(
		"settings.apiKeys.form.nameMinLength",
		"Name must be at least 3 characters",
	);
	const rateLimitMaxInvalidMessage = t(
		"settings.apiKeys.form.rateLimitMaxInvalid",
		"Enter a whole number from 10 to 10,000",
	);

	const createMutation = useMutation({
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: ["apiKeys", organizationId],
			});
		},
		mutationFn: async (value: ApiKeyCreateFormValues) => {
			const result = await createApiKey(organizationId, {
				name: value.name.trim(),
				expiresInDays:
					value.expiresIn === "never" ? null : parseInt(value.expiresIn, 10),
				scopes: value.selectedScopes,
				rateLimitEnabled: value.rateLimitEnabled,
				rateLimitMax: Number(
					value.rateLimitEnabled
						? value.rateLimitMax
						: DEFAULT_FORM_VALUES.rateLimitMax,
				),
				rateLimitTimeWindow: 60000, // 1 minute
			});
			if (!result.success)
				throw new Error(result.error || "Failed to create API key");
			return result.data;
		},
	});

	const form = useForm({
		defaultValues: DEFAULT_FORM_VALUES,
		validators: {
			onMount: ({ value }) => validateForm(value, invalidFormMessage),
			onChange: ({ value }) => validateForm(value, invalidFormMessage),
			onSubmit: ({ value }) => validateForm(value, invalidFormMessage),
		},
		onSubmit: async ({ value }) => {
			try {
				const data = await createMutation.mutateAsync(value);
				form.reset(DEFAULT_FORM_VALUES);
				toast.success(
					t("settings.apiKeys.created", "API key created successfully"),
				);
				onKeyCreated(data);
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Failed to create API key",
				);
			}
		},
	});

	const handleOpenChange = (isOpen: boolean) => {
		if (createMutation.isPending || form.state.isSubmitting) return;
		form.reset(DEFAULT_FORM_VALUES);
		onOpenChange(isOpen);
	};

	return {
		createMutation,
		form,
		handleOpenChange,
		nameMinLengthMessage,
		rateLimitMaxInvalidMessage,
		t,
	};
}

export function ApiKeyCreateFormBody(props: ApiKeyCreateDialogProps) {
	const { open } = props;
	const {
		createMutation,
		form,
		handleOpenChange,
		nameMinLengthMessage,
		rateLimitMaxInvalidMessage,
		t,
	} = useApiKeyCreateController(props);

	return (
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			<ActionPanelContent showCloseButton={!createMutation.isPending}>
				<form
					className="contents"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.apiKeys.createTitle", "Create API Key")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.apiKeys.createDescription",
								"Create a new API key for programmatic access. The key will only be shown once.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
						<form.Field
							name="name"
							validators={{
								onChange: ({ value }) =>
									isNameValid(value) ? undefined : nameMinLengthMessage,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel htmlFor="name" hasError={fieldHasError(field)}>
										{t("settings.apiKeys.form.name", "Name")} *
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											id="name"
											name="apiKeyName"
											autoComplete="off"
											value={field.state.value}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
											placeholder={t(
												"settings.apiKeys.form.namePlaceholder",
												"e.g., Production API",
											)}
											maxLength={100}
										/>
									</TFormControl>
									<TFormDescription className="text-xs">
										{t(
											"settings.apiKeys.form.nameHelp",
											"A descriptive name to identify this key",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>

						<form.Field name="expiresIn">
							{(field) => (
								<TFormItem>
									<TFormLabel htmlFor="expiration">
										{t("settings.apiKeys.form.expiration", "Expiration")}
									</TFormLabel>
									<Select<ExpirationValue>
										value={field.state.value}
										onValueChange={(value) => {
											if (value !== null) field.handleChange(value);
										}}
									>
										<TFormControl>
											<SelectTrigger id="expiration" onBlur={field.handleBlur}>
												<SelectValue />
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{EXPIRATION_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{t(
														`settings.apiKeys.expiration.${option.value}`,
														option.label,
													)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>

						<form.Field
							name="selectedScopes"
							validators={{
								onChange: ({ value }) =>
									value.length > 0
										? undefined
										: t(
												"settings.apiKeys.form.scopesRequired",
												"Select at least one permission",
											),
							}}
						>
							{(field) => (
								<fieldset
									className="space-y-2"
									aria-describedby={
										fieldHasError(field) ? "api-key-scopes-error" : undefined
									}
								>
									<legend className="font-medium text-sm leading-none">
										{t("settings.apiKeys.form.scopes", "Permissions")} *
									</legend>
									<div className="grid grid-cols-2 gap-2 p-3 border rounded-md bg-muted/30">
										{API_KEY_SCOPES.map((scope) => (
											<div key={scope} className="flex items-center gap-x-2">
												<Checkbox
													id={scope}
													checked={field.state.value.includes(scope)}
													onCheckedChange={() =>
														field.handleChange(
															field.state.value.includes(scope)
																? field.state.value.filter(
																		(selectedScope) => selectedScope !== scope,
																	)
																: [...field.state.value, scope],
														)
													}
												/>
												<Label
													htmlFor={scope}
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
									{fieldHasError(field) && (
										<p
											id="api-key-scopes-error"
											className="text-xs text-destructive"
											role="alert"
										>
											{field.state.meta.errors.join(", ")}
										</p>
									)}
								</fieldset>
							)}
						</form.Field>

						<form.Field name="rateLimitEnabled">
							{(field) => (
								<div className="space-y-3">
									<div className="flex items-center gap-x-2">
										<Checkbox
											id="rateLimitEnabled"
											checked={field.state.value}
											onCheckedChange={(checked) =>
												field.handleChange(checked === true)
											}
										/>
										<Label
											htmlFor="rateLimitEnabled"
											className="font-normal cursor-pointer"
										>
											{t(
												"settings.apiKeys.form.rateLimit",
												"Enable rate limiting",
											)}
										</Label>
									</div>
									{field.state.value && (
										<form.Field
											name="rateLimitMax"
											validators={{
												onChange: ({ value }) =>
													validateRateLimitMax(
														value,
														rateLimitMaxInvalidMessage,
													),
											}}
										>
											{(rateLimitField) => (
												<TFormItem className="ml-6">
													<TFormLabel
														htmlFor="rateLimitMax"
														hasError={fieldHasError(rateLimitField)}
													>
														{t(
															"settings.apiKeys.form.rateLimitMax",
															"Max requests per minute",
														)}
													</TFormLabel>
													<TFormControl
														hasError={fieldHasError(rateLimitField)}
													>
														<Input
															id="rateLimitMax"
															name="rateLimitMax"
															type="number"
															value={rateLimitField.state.value}
															onChange={(event) =>
																rateLimitField.handleChange(event.target.value)
															}
															onBlur={rateLimitField.handleBlur}
															min={10}
															max={10000}
															className="w-32"
														/>
													</TFormControl>
													<TFormMessage field={rateLimitField} />
												</TFormItem>
											)}
										</form.Field>
									)}
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							disabled={createMutation.isPending}
							onClick={() => handleOpenChange(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe<[boolean, boolean]>
							selector={(state) => [state.canSubmit, state.isSubmitting]}
						>
							{([canSubmit, isSubmitting]) => (
								<Button type="submit" disabled={!canSubmit || isSubmitting}>
									{isSubmitting && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
									{t("settings.apiKeys.form.create", "Create Key")}
								</Button>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
