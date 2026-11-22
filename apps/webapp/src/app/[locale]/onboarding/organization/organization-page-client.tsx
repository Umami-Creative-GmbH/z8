"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
} from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { checkSlugAvailability } from "@/app/[locale]/(app)/organization-actions";
import { useRefreshOnboardingIsAdmin } from "@/components/onboarding/onboarding-progress-provider";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { OrganizationTrackingSetupFields } from "@/components/organization/organization-tracking-setup-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/auth-client";
import { generateSlug, organizationSchema } from "@/lib/validations/organization";
import { getNextOnboardingStepPath, ONBOARDING_STEPS } from "@/lib/validations/onboarding-steps";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import {
	createOrganizationOnboarding,
	getOnboardingSummary,
	skipOrganizationSetup,
} from "./actions";

const defaultValues = {
	timezone: "UTC",
	trackingStartDate: "",
	name: "",
	slug: "",
};

const ORGANIZATION_NEXT_STEP_PATH =
	getNextOnboardingStepPath("organization", false) ?? ONBOARDING_STEPS.profile.path;

type OrganizationValues = typeof defaultValues;
type OrganizationForm = ReactFormExtendedApi<
	OrganizationValues,
	FormValidateOrFn<OrganizationValues> | undefined,
	FormValidateOrFn<OrganizationValues> | undefined,
	FormAsyncValidateOrFn<OrganizationValues> | undefined,
	FormValidateOrFn<OrganizationValues> | undefined,
	FormAsyncValidateOrFn<OrganizationValues> | undefined,
	FormValidateOrFn<OrganizationValues> | undefined,
	FormAsyncValidateOrFn<OrganizationValues> | undefined,
	FormValidateOrFn<OrganizationValues> | undefined,
	FormAsyncValidateOrFn<OrganizationValues> | undefined,
	FormAsyncValidateOrFn<OrganizationValues> | undefined,
	unknown
>;
type TranslationFunction = ReturnType<typeof useTranslate>["t"];
type SlugError = { slug: string; message: string } | null;

function getErrorMessage(error: unknown) {
	if (typeof error === "string") return error;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return undefined;
}

type OrganizationPageClientProps = {
	canCreateOrganizations: boolean;
	trackingSuggestedAt?: string;
};

function OrganizationSetupHeader({
	canCreateOrganizations,
	t,
}: {
	canCreateOrganizations: boolean;
	t: (key: string, defaultValue: string) => string;
}) {
	return (
		<div className="mb-6 rounded-xl border bg-card p-6 text-card-foreground sm:p-8">
			<h1 className="mb-3 text-2xl font-semibold tracking-tight sm:text-3xl">
				{t("onboarding.organization.title", "Set up your organization")}
			</h1>
			<p className="text-muted-foreground">
				{canCreateOrganizations
					? t(
							"onboarding.organization.subtitle",
							"Create your organization to unlock all features, or skip if you're waiting for an invitation.",
						)
					: t(
							"onboarding.organization.disabledSubtitle",
							"Organization creation is disabled for this deployment.",
						)}
			</p>
		</div>
	);
}

function OrganizationSkipCard({
	canCreateOrganizations,
	loading,
	onSkip,
	t,
}: {
	canCreateOrganizations: boolean;
	loading: boolean;
	onSkip: () => void;
	t: (key: string, defaultValue: string) => string;
}) {
	return (
		<section
			aria-labelledby="organization-skip-title"
			className="self-start rounded-xl border bg-card text-card-foreground"
		>
			<header className="space-y-2 border-b p-6">
				<h2 id="organization-skip-title" className="font-semibold">
					{t("onboarding.organization.skipTitle", "Waiting for an Invitation?")}
				</h2>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{canCreateOrganizations
						? t(
								"onboarding.organization.skipDescription",
								"If your administrator will invite you to an organization, you can skip this step for now.",
							)
						: t(
								"onboarding.organization.disabledSkipDescription",
								"You can continue by skipping this step while you wait for an invitation to an existing organization.",
							)}
				</p>
			</header>
			<div className="p-6">
				<Button variant="outline" onClick={onSkip} disabled={loading} className="w-full">
					{t("onboarding.organization.skip", "Skip for now")}
				</Button>
			</div>
		</section>
	);
}

function CreateOrganizationCard({
	trackingSuggestedAt,
	form,
	status,
	setSlugError,
	t,
}: {
	form: OrganizationForm;
	trackingSuggestedAt?: string;
	status: {
		checkingSlug: boolean;
		loading: boolean;
		slugErrorMessage: string | null;
		slugAvailable: boolean;
	};
	setSlugError: (error: SlugError) => void;
	t: TranslationFunction;
}) {
	const slugManuallyEdited = useRef(false);

	return (
		<section
			aria-labelledby="organization-create-title"
			className="min-w-0 rounded-xl border bg-card text-card-foreground"
		>
			<header className="space-y-2 border-b p-6">
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
						<IconBuilding aria-hidden="true" className="size-5 text-primary" />
					</div>
					<div>
						<h2 id="organization-create-title" className="font-semibold">
							{t("onboarding.organization.createTitle", "Create Organization")}
						</h2>
						<p className="text-sm leading-relaxed text-muted-foreground">
							{t(
								"onboarding.organization.createDescription",
								"Set up your own organization and invite your team",
							)}
						</p>
					</div>
				</div>
			</header>
			<div className="p-6">
				<form
					aria-busy={status.loading}
					action={() => {
						void form.handleSubmit();
					}}
					className="space-y-6"
				>
					<form.Field
						name="name"
						validators={{
							onChange: z
								.string()
								.min(
									2,
									t(
										"onboarding.organization.nameErrors.min",
										"Organization name must be at least 2 characters",
									),
								)
								.max(
									100,
									t(
										"onboarding.organization.nameErrors.max",
										"Organization name must be less than 100 characters",
									),
								),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="organization-name">
									{t("onboarding.organization.nameLabel", "Organization Name")}
								</Label>
								<Input
									id="organization-name"
									name="name"
									autoComplete="organization"
									aria-invalid={field.state.meta.errors.length > 0}
									aria-describedby={
										field.state.meta.errors.length ? "organization-name-error" : undefined
									}
									value={field.state.value}
									onChange={(event) => {
										const nextName = event.target.value;
										field.handleChange(nextName);
										if (nextName && !slugManuallyEdited.current) {
											setSlugError(null);
											form.setFieldValue("slug", generateSlug(nextName));
										}
									}}
									onBlur={field.handleBlur}
									placeholder={t("onboarding.organization.namePlaceholder", "Acme Inc.")}
									disabled={status.loading}
								/>
								{field.state.meta.errors.length > 0 && (
									<p
										id="organization-name-error"
										role="alert"
										className="text-sm font-medium text-destructive"
									>
										{getErrorMessage(field.state.meta.errors[0])}
									</p>
								)}
							</div>
						)}
					</form.Field>
					<form.Field
						name="slug"
						validators={{
							onChange: z
								.string()
								.min(
									2,
									t("onboarding.organization.slugErrors.min", "Slug must be at least 2 characters"),
								)
								.max(
									50,
									t(
										"onboarding.organization.slugErrors.max",
										"Slug must be less than 50 characters",
									),
								)
								.regex(
									/^[a-z0-9-]+$/,
									t(
										"onboarding.organization.slugErrors.format",
										"Slug must contain only lowercase letters, numbers, and hyphens",
									),
								)
								.refine((value) => !value.startsWith("-") && !value.endsWith("-"), {
									message: t(
										"onboarding.organization.slugErrors.hyphen",
										"Slug cannot start or end with a hyphen",
									),
								}),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="organization-slug">
									{t("onboarding.organization.slugLabel", "Organization Slug")}
								</Label>
								<div className="relative">
									<Input
										id="organization-slug"
										name="slug"
										autoComplete="off"
										spellCheck={false}
										aria-invalid={!!status.slugErrorMessage || field.state.meta.errors.length > 0}
										aria-describedby={`organization-slug-description organization-slug-status${status.slugErrorMessage ? " organization-slug-error" : ""}${field.state.meta.errors.length ? " organization-slug-validation" : ""}`}
										value={field.state.value}
										onChange={(event) => {
											slugManuallyEdited.current = true;
											setSlugError(null);
											field.handleChange(event.target.value);
										}}
										onBlur={field.handleBlur}
										placeholder={t("onboarding.organization.slugPlaceholder", "acme-inc")}
										disabled={status.loading}
									/>
									{status.checkingSlug && (
										<div className="absolute right-3 top-1/2 -translate-y-1/2">
											<IconLoader2 className="size-4 animate-spin text-muted-foreground" />
										</div>
									)}
								</div>
								<p id="organization-slug-description" className="text-sm text-muted-foreground">
									{t(
										"onboarding.organization.slugDescription",
										"Used in URLs. Auto-generated from name.",
									)}
								</p>
								<p
									id="organization-slug-status"
									role="status"
									className="text-sm text-muted-foreground"
								>
									{status.checkingSlug
										? t("onboarding.organization.checkingSlug", "Checking availability…")
										: status.slugAvailable
											? t("onboarding.organization.slugAvailable", "This slug is available.")
											: ""}
								</p>
								{status.slugErrorMessage && (
									<p
										id="organization-slug-error"
										role="alert"
										className="text-sm font-medium text-destructive"
									>
										{status.slugErrorMessage}
									</p>
								)}
								{field.state.meta.errors.length > 0 && (
									<p
										id="organization-slug-validation"
										role="alert"
										className="text-sm font-medium text-destructive"
									>
										{getErrorMessage(field.state.meta.errors[0])}
									</p>
								)}
							</div>
						)}
					</form.Field>
					<form.Field name="timezone">
						{(timezoneField) => (
							<form.Field
								name="trackingStartDate"
								validators={{
									onChange: organizationSchema.shape.trackingStartDate.unwrap(),
								}}
							>
								{(dateField) => (
									<OrganizationTrackingSetupFields
										timezone={timezoneField.state.value}
										trackingStartDate={dateField.state.value}
										suggestedAt={trackingSuggestedAt}
										disabled={status.loading}
										onTimezoneChange={timezoneField.handleChange}
										onDateChange={dateField.handleChange}
										error={getErrorMessage(dateField.state.meta.errors[0])}
									/>
								)}
							</form.Field>
						)}
					</form.Field>
					<div className="flex gap-3 pt-2">
						<Button
							type="submit"
							disabled={status.loading || status.checkingSlug || !!status.slugErrorMessage}
							className="flex-1"
						>
							{status.loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("onboarding.organization.create", "Create Organization")}
						</Button>
					</div>
				</form>
			</div>
		</section>
	);
}

export default function OrganizationPageClient(props: OrganizationPageClientProps) {
	const { data, refetch } = useSession();
	const operations = useRef(new Set<string>());
	const [pendingScopes, setPendingScopes] = useState(new Set<string>());
	// A different account or organization owns a different draft and request lifetime.
	const scope = `${data?.user.id ?? "pending"}:${data?.session.id ?? ""}:${data?.session.activeOrganizationId ?? ""}`;
	function setLoading(next: boolean) {
		if (next) operations.current.add(scope);
		else operations.current.delete(scope);
		setPendingScopes(new Set(operations.current));
	}
	function acquireOperation() {
		if (operations.current.has(scope)) return false;
		setLoading(true);
		return true;
	}
	return (
		<OrganizationSetup
			key={scope}
			{...props}
			loading={pendingScopes.has(scope)}
			acquireOperation={acquireOperation}
			setLoading={setLoading}
			onSessionRefresh={() => {
				void refetch?.();
			}}
		/>
	);
}

function OrganizationSetup({
	canCreateOrganizations,
	trackingSuggestedAt,
	loading,
	acquireOperation,
	setLoading,
	onSessionRefresh,
}: OrganizationPageClientProps & {
	loading: boolean;
	acquireOperation: () => boolean;
	setLoading: (next: boolean) => void;
	onSessionRefresh: () => void;
}) {
	const { t } = useTranslate();
	const { push, replace } = useRouter();
	const refreshOnboardingIsAdmin = useRefreshOnboardingIsAdmin();
	const [checkingSlugFor, setCheckingSlugFor] = useState<string | null>(null);
	const [availableSlug, setAvailableSlug] = useState<string | null>(null);
	const [slugError, setSlugError] = useState<SlugError>(null);
	const [checkingMembership, setCheckingMembership] = useState(true);
	const slugRequestIdRef = useRef(0);
	const lifetime = useRef<object | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	function showActionError(message: string) {
		setActionError(message);
		toast.error(message);
	}

	useEffect(() => {
		lifetime.current = {};
		return () => {
			lifetime.current = null;
		};
	}, []);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (!canCreateOrganizations || slugError?.slug === value.slug) {
				return;
			}
			if (!acquireOperation()) return;
			const requestLifetime = lifetime.current;
			setActionError(null);

			await runOnboardingAction({
				action: () => createOrganizationOnboarding(value),
				onResult: (result) => {
					if (!requestLifetime || lifetime.current !== requestLifetime) return;
					if (result.success) {
						toast.success(
							t("onboarding.organization.createSuccess", "Organization created successfully!"),
						);
						onSessionRefresh();
						void refreshOnboardingIsAdmin();
						push(ORGANIZATION_NEXT_STEP_PATH);
						return true;
					} else {
						showActionError(
							result.error ||
								t("onboarding.organization.createError", "Failed to create organization"),
						);
					}
				},
				onRejected: () => {
					if (!requestLifetime || lifetime.current !== requestLifetime) return;
					showActionError(
						t("onboarding.organization.createError", "Failed to create organization"),
					);
				},
				setLoading,
			});
		},
	});

	const formValues = useStore(form.store, (state) => state.values);
	const slug = formValues.slug;
	const checkingSlug = checkingSlugFor === slug;
	const slugErrorMessage = slugError?.slug === slug ? slugError.message : null;
	const getSlugTakenMessage = useEffectEvent(() =>
		t(
			"onboarding.organization.slugTaken",
			"This slug is already taken. Please choose a different one.",
		),
	);
	const getSlugCheckError = useEffectEvent(() =>
		t(
			"onboarding.organization.slugCheckError",
			"Could not check availability. Edit the slug to retry.",
		),
	);
	const getSkipError = useEffectEvent(() =>
		t("onboarding.organization.skipError", "Failed to skip organization setup"),
	);

	useEffect(() => {
		let cancelled = false;

		const checkMembership = async () => {
			try {
				const summary = await getOnboardingSummary();
				if (cancelled) {
					return;
				}

				if (summary.success && summary.data?.hasOrganization) {
					const result = await skipOrganizationSetup();
					if (cancelled) {
						return;
					}

					if (result.success) {
						replace(ORGANIZATION_NEXT_STEP_PATH);
						return;
					}
					setActionError(result.error || getSkipError());
				}

				setCheckingMembership(false);
			} catch {
				if (!cancelled) {
					setCheckingMembership(false);
				}
			}
		};

		void checkMembership();

		return () => {
			cancelled = true;
		};
	}, [replace]);

	useEffect(() => {
		const requestId = ++slugRequestIdRef.current;
		if (!canCreateOrganizations || !slug || slug.length < 2) {
			return;
		}

		const timeoutId = setTimeout(async () => {
			setCheckingSlugFor(slug);
			try {
				const isAvailable = await checkSlugAvailability(slug);
				if (slugRequestIdRef.current !== requestId) {
					return;
				}

				if (!isAvailable) {
					setSlugError({
						slug,
						message: getSlugTakenMessage(),
					});
				} else {
					setSlugError(null);
					setAvailableSlug(slug);
				}
			} catch {
				if (slugRequestIdRef.current === requestId) {
					setSlugError({ slug, message: getSlugCheckError() });
				}
			}

			if (slugRequestIdRef.current === requestId) {
				setCheckingSlugFor(null);
			}
		}, 500);

		return () => {
			clearTimeout(timeoutId);
			if (slugRequestIdRef.current === requestId) {
				slugRequestIdRef.current += 1;
			}
		};
	}, [canCreateOrganizations, slug]);

	async function handleSkip() {
		if (!acquireOperation()) return;
		const requestLifetime = lifetime.current;
		setActionError(null);
		await runOnboardingAction({
			action: skipOrganizationSetup,
			onResult: (result) => {
				if (!requestLifetime || lifetime.current !== requestLifetime) return;
				if (result.success) {
					push(ORGANIZATION_NEXT_STEP_PATH);
					return true;
				} else {
					showActionError(
						result.error ||
							t("onboarding.organization.skipError", "Failed to skip organization setup"),
					);
				}
			},
			onRejected: () => {
				if (!requestLifetime || lifetime.current !== requestLifetime) return;
				showActionError(
					t("onboarding.organization.skipError", "Failed to skip organization setup"),
				);
			},
			setLoading,
		});
	}

	if (checkingMembership) {
		return (
			<>
				<ProgressIndicator currentStep="organization" />
				<div className="mx-auto max-w-4xl">
					<OrganizationSetupHeader canCreateOrganizations={canCreateOrganizations} t={t} />
					<div
						role="status"
						aria-label={t(
							"onboarding.organization.checkingMembership",
							"Checking organization membership",
						)}
						className="mx-auto flex max-w-2xl justify-center py-12"
					>
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				</div>
			</>
		);
	}

	return (
		<>
			<ProgressIndicator currentStep="organization" />

			<div className="mx-auto max-w-4xl">
				<OrganizationSetupHeader canCreateOrganizations={canCreateOrganizations} t={t} />

				<div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
					{actionError ? (
						<p
							role="alert"
							className="rounded-lg border border-destructive/30 bg-background p-4 text-sm text-destructive lg:col-span-full"
						>
							{actionError}
						</p>
					) : null}
					{canCreateOrganizations && (
						<CreateOrganizationCard
							trackingSuggestedAt={trackingSuggestedAt}
							form={form}
							status={{
								checkingSlug,
								loading,
								slugErrorMessage,
								slugAvailable: availableSlug === slug,
							}}
							setSlugError={(error) => {
								setSlugError(error);
								setAvailableSlug(null);
							}}
							t={t}
						/>
					)}

					<OrganizationSkipCard
						canCreateOrganizations={canCreateOrganizations}
						loading={loading}
						onSkip={handleSkip}
						t={t}
					/>
				</div>
			</div>
		</>
	);
}
