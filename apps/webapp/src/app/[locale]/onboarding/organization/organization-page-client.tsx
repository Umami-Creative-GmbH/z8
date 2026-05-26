"use client";

import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { checkSlugAvailability } from "@/app/[locale]/(app)/organization-actions";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateSlug } from "@/lib/validations/organization";
import { useRouter } from "@/navigation";
import { createOrganizationOnboarding, getOnboardingSummary, skipOrganizationSetup } from "./actions";

const defaultValues = {
	name: "",
	slug: "",
};

type OrganizationPageClientProps = {
	canCreateOrganizations: boolean;
};

export default function OrganizationPageClient({ canCreateOrganizations }: OrganizationPageClientProps) {
	const { t } = useTranslate();
	const { push, replace } = useRouter();
	const [loading, setLoading] = useState(false);
	const [checkingSlug, setCheckingSlug] = useState(false);
	const [slugError, setSlugError] = useState<string | null>(null);
	const [checkingMembership, setCheckingMembership] = useState(true);
	const slugManuallyEdited = useRef(false);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (slugError) {
				return;
			}

			setLoading(true);

			const result = await createOrganizationOnboarding(value);

			if (result.success) {
				toast.success(t("organization.createSuccess", "Organization created successfully!"));
				push("/onboarding/profile");
			} else {
				setLoading(false);
				toast.error(result.error || t("organization.createError", "Failed to create organization"));
			}
		},
	});

	const formValues = useStore(form.store, (state) => state.values);
	const name = formValues.name;
	const slug = formValues.slug;

	useEffect(() => {
		const checkMembership = async () => {
			const summary = await getOnboardingSummary();

			if (summary.success && summary.data?.hasOrganization) {
				await skipOrganizationSetup();
				replace("/onboarding/profile");
				return;
			}

			setCheckingMembership(false);
		};

		void checkMembership();
	}, [replace]);

	useEffect(() => {
		if (name && !slugManuallyEdited.current) {
			const generatedSlug = generateSlug(name);
			form.setFieldValue("slug", generatedSlug);
		}
	}, [name, form]);

	useEffect(() => {
		if (!canCreateOrganizations || !slug || slug.length < 2) {
			setSlugError(null);
			return;
		}

		const timeoutId = setTimeout(async () => {
			setCheckingSlug(true);
			try {
				const isAvailable = await checkSlugAvailability(slug);
				if (!isAvailable) {
					setSlugError(
						t(
							"organization.slugTaken",
							"This slug is already taken. Please choose a different one.",
						),
					);
				} else {
					setSlugError(null);
				}
			} catch (error) {
				console.error("Error checking slug availability:", error);
			} finally {
				setCheckingSlug(false);
			}
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [canCreateOrganizations, slug, t]);

	async function handleSkip() {
		setLoading(true);

		const result = await skipOrganizationSetup();

		if (result.success) {
			push("/onboarding/profile");
		} else {
			setLoading(false);
			toast.error(result.error || t("onboarding.organization.skipError", "Failed to skip organization setup"));
		}
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

				<div className="space-y-6">
					{canCreateOrganizations && (
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
									onSubmit={(e) => {
										e.preventDefault();
										form.handleSubmit();
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
												<Label>{t("organization.nameLabel", "Organization Name")}</Label>
												<Input
													value={field.state.value}
													onChange={(e) => field.handleChange(e.target.value)}
													onBlur={field.handleBlur}
													placeholder={t("organization.namePlaceholder", "Acme Inc.")}
													disabled={loading}
												/>
												{field.state.meta.errors.length > 0 && (
													<p className="text-sm font-medium text-destructive">
														{typeof field.state.meta.errors[0] === "string"
															? field.state.meta.errors[0]
															: (field.state.meta.errors[0] as any)?.message}
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
												.min(2, t("organization.slugErrors.min", "Slug must be at least 2 characters"))
												.max(50, t("organization.slugErrors.max", "Slug must be less than 50 characters"))
												.regex(
													/^[a-z0-9-]+$/,
													t("organization.slugErrors.format", "Slug must contain only lowercase letters, numbers, and hyphens"),
												)
												.refine((slug) => !slug.startsWith("-") && !slug.endsWith("-"), {
													message: t("organization.slugErrors.hyphen", "Slug cannot start or end with a hyphen"),
												}),
										}}
									>
										{(field) => (
											<div className="space-y-2">
												<Label>{t("organization.slugLabel", "Organization Slug")}</Label>
												<div className="relative">
													<Input
														value={field.state.value}
														onChange={(e) => {
															slugManuallyEdited.current = true;
															field.handleChange(e.target.value);
														}}
														onBlur={field.handleBlur}
														placeholder={t("organization.slugPlaceholder", "acme-inc")}
														disabled={loading}
													/>
													{checkingSlug && (
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
												{slugError && (
													<p className="text-sm font-medium text-destructive">{slugError}</p>
												)}
												{field.state.meta.errors.length > 0 && (
													<p className="text-sm font-medium text-destructive">
														{typeof field.state.meta.errors[0] === "string"
															? field.state.meta.errors[0]
															: (field.state.meta.errors[0] as any)?.message}
													</p>
												)}
											</div>
										)}
									</form.Field>

									<div className="flex gap-3 pt-2">
										<Button
											type="submit"
											disabled={loading || checkingSlug || !!slugError}
											className="flex-1"
										>
											{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
											{t("onboarding.organization.create", "Create Organization")}
										</Button>
									</div>
								</form>
							</CardContent>
						</Card>
					)}

					<Card>
						<CardHeader>
							<CardTitle>{t("onboarding.organization.skipTitle", "Waiting for an Invitation?")}</CardTitle>
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
							<Button variant="outline" onClick={handleSkip} disabled={loading} className="w-full">
								{t("onboarding.organization.skip", "Skip for now")}
							</Button>
						</CardContent>
					</Card>
				</div>
			</div>
		</>
	);
}
