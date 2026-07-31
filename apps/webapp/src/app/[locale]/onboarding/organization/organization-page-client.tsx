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
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateSlug } from "@/lib/validations/organization";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import {
	createOrganizationOnboarding,
	getOnboardingSummary,
	skipOrganizationSetup,
} from "./actions";

const defaultValues = {
	name: "",
	slug: "",
};

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
};

function OrganizationSetupHeader({
	canCreateOrganizations,
	t,
}: {
	canCreateOrganizations: boolean;
	t: (key: string, defaultValue: string) => string;
}) {
	return (
		<div className="mb-8 text-center">
			<h1 className="mb-4 text-3xl font-bold tracking-tight">
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
		<Card>
			<CardHeader>
				<CardTitle>
					{t("onboarding.organization.skipTitle", "Waiting for an Invitation?")}
				</CardTitle>
				<CardDescription>
					{canCreateOrganizations
						? t(
								"onboarding.organization.skipDescription",
								"If your administrator will invite you to an organization, you can skip this step for now.",
							)
						: t(
								"onboarding.organization.disabledSkipDescription",
								"You can continue by skipping this step while you wait for an invitation to an existing organization.",
							)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Button
					variant="outline"
					onClick={onSkip}
					disabled={loading}
					className="w-full"
				>
					{t("onboarding.organization.skip", "Skip for now")}
				</Button>
			</CardContent>
		</Card>
	);
}

function CreateOrganizationCard({
	form,
	status,
	setSlugError,
	t,
}: {
	form: OrganizationForm;
	status: {
		checkingSlug: boolean;
		loading: boolean;
		slugErrorMessage: string | null;
	};
	setSlugError: (error: SlugError) => void;
	t: TranslationFunction;
}) {
	const slugManuallyEdited = useRef(false);

	return (
		<Card className="border-primary/50">
			<CardHeader>
				<div className="flex items-center gap-3">
					<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
						<IconBuilding className="size-5 text-primary" />
					</div>
					<div>
						<CardTitle>
							{t("onboarding.organization.createTitle", "Create Organization")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.organization.createDescription",
								"Set up your own organization and invite your team",
							)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				<form
					action={() => {
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field
						name="name"
						validators={{
							onChange: z
								.string()
								.min(2, "Organization name must be at least 2 characters")
								.max(100, "Organization name must be less than 100 characters"),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="organization-name">
									{t("organization.nameLabel", "Organization Name")}
								</Label>
								<Input
									id="organization-name"
									value={field.state.value}
									onChange={(event) => {
										const nextName = event.target.value;
										field.handleChange(nextName);
										if (nextName && !slugManuallyEdited.current) {
											form.setFieldValue("slug", generateSlug(nextName));
										}
									}}
									onBlur={field.handleBlur}
									placeholder={t("organization.namePlaceholder", "Acme Inc.")}
									disabled={status.loading}
								/>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm font-medium text-destructive">
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
									t(
										"organization.slugErrors.min",
										"Slug must be at least 2 characters",
									),
								)
								.max(
									50,
									t(
										"organization.slugErrors.max",
										"Slug must be less than 50 characters",
									),
								)
								.regex(
									/^[a-z0-9-]+$/,
									t(
										"organization.slugErrors.format",
										"Slug must contain only lowercase letters, numbers, and hyphens",
									),
								)
								.refine(
									(value) => !value.startsWith("-") && !value.endsWith("-"),
									{
										message: t(
											"organization.slugErrors.hyphen",
											"Slug cannot start or end with a hyphen",
										),
									},
								),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="organization-slug">
									{t("organization.slugLabel", "Organization Slug")}
								</Label>
								<div className="relative">
									<Input
										id="organization-slug"
										value={field.state.value}
										onChange={(event) => {
											slugManuallyEdited.current = true;
											setSlugError(null);
											field.handleChange(event.target.value);
										}}
										onBlur={field.handleBlur}
										placeholder={t("organization.slugPlaceholder", "acme-inc")}
										disabled={status.loading}
									/>
									{status.checkingSlug && (
										<div className="absolute right-3 top-1/2 -translate-y-1/2">
											<IconLoader2 className="size-4 animate-spin text-muted-foreground" />
										</div>
									)}
								</div>
								<p className="text-sm text-muted-foreground">
									{t(
										"organization.slugDescription",
										"Used in URLs. Auto-generated from name.",
									)}
								</p>
								{status.slugErrorMessage && (
									<p className="text-sm font-medium text-destructive">
										{status.slugErrorMessage}
									</p>
								)}
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm font-medium text-destructive">
										{getErrorMessage(field.state.meta.errors[0])}
									</p>
								)}
							</div>
						)}
					</form.Field>
					<div className="flex gap-3 pt-2">
						<Button
							type="submit"
							disabled={
								status.loading ||
								status.checkingSlug ||
								!!status.slugErrorMessage
							}
							className="flex-1"
						>
							{status.loading && (
								<IconLoader2 className="mr-2 size-4 animate-spin" />
							)}
							{t("onboarding.organization.create", "Create Organization")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

export default function OrganizationPageClient({
	canCreateOrganizations,
}: OrganizationPageClientProps) {
	const { t } = useTranslate();
	const { push, replace } = useRouter();
	const [loading, setLoading] = useState(false);
	const [checkingSlugFor, setCheckingSlugFor] = useState<string | null>(null);
	const [slugError, setSlugError] = useState<SlugError>(null);
	const [checkingMembership, setCheckingMembership] = useState(true);
	const slugRequestIdRef = useRef(0);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (slugError?.slug === value.slug) {
				return;
			}

			await runOnboardingAction({
				action: () => createOrganizationOnboarding(value),
				onResult: (result) => {
					if (result.success) {
						toast.success(
							t(
								"organization.createSuccess",
								"Organization created successfully!",
							),
						);
						push("/onboarding/profile");
						return true;
					} else {
						toast.error(
							result.error ||
								t("organization.createError", "Failed to create organization"),
						);
					}
				},
				onRejected: () => {
					toast.error(
						t("organization.createError", "Failed to create organization"),
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
			"organization.slugTaken",
			"This slug is already taken. Please choose a different one.",
		),
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
					await skipOrganizationSetup();
					if (cancelled) {
						return;
					}

					replace("/onboarding/profile");
					return;
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
				}
			} catch (error) {
				if (slugRequestIdRef.current === requestId) {
					console.error("Error checking slug availability:", error);
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
		await runOnboardingAction({
			action: skipOrganizationSetup,
			onResult: (result) => {
				if (result.success) {
					push("/onboarding/profile");
					return true;
				} else {
					toast.error(
						result.error ||
							t(
								"onboarding.organization.skipError",
								"Failed to skip organization setup",
							),
					);
				}
			},
			onRejected: () => {
				toast.error(
					t(
						"onboarding.organization.skipError",
						"Failed to skip organization setup",
					),
				);
			},
			setLoading,
		});
	}

	if (checkingMembership) {
		return (
			<>
				<ProgressIndicator currentStep="organization" />
				<div className="mx-auto flex max-w-2xl justify-center py-12">
					<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
				</div>
			</>
		);
	}

	return (
		<>
			<ProgressIndicator currentStep="organization" />

			<div className="mx-auto max-w-2xl">
				<OrganizationSetupHeader
					canCreateOrganizations={canCreateOrganizations}
					t={t}
				/>

				<div className="space-y-6">
					{canCreateOrganizations && (
						<CreateOrganizationCard
							form={form}
							status={{ checkingSlug, loading, slugErrorMessage }}
							setSlugError={setSlugError}
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
