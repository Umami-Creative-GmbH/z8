"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { checkSlugAvailability } from "@/app/[locale]/(app)/actions/organization";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { generateSlug } from "@/lib/validations/organization";
import { useRouter } from "@/navigation";
import { createOrganizationOnboarding, skipOrganizationSetup } from "./actions";

const defaultValues = {
	name: "",
	slug: "",
};

export default function OrganizationPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [checkingSlug, setCheckingSlug] = useState(false);
	const [slugError, setSlugError] = useState<string | null>(null);
	const [showCreateForm, _setShowCreateForm] = useState(true);
	const slugManuallyEdited = useRef(false);

	const form = useForm({
		defaultValues,
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			if (slugError) {
				return;
			}

			setLoading(true);

			const result = await createOrganizationOnboarding(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("organization.createSuccess", "Organization created successfully!"));
				router.push("/onboarding/profile");
			} else {
				toast.error(result.error || t("organization.createError", "Failed to create organization"));
			}
		},
	});

	// Subscribe to form values
	const formValues = useStore(form.store, (state) => state.values);
	const name = formValues.name;
	const slug = formValues.slug;

	// Auto-generate slug from name
	useEffect(() => {
		if (name && !slugManuallyEdited.current) {
			const generatedSlug = generateSlug(name);
			form.setFieldValue("slug", generatedSlug);
		}
	}, [name, form]);

	// Validate slug availability (debounced)
	useEffect(() => {
		if (!slug || slug.length < 2) {
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
	}, [slug, t]);

	async function handleSkip() {
		setLoading(true);

		const result = await skipOrganizationSetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/profile");
		} else {
			toast.error(result.error || "Failed to skip organization setup");
		}
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
						{t(
							"onboarding.organization.subtitle",
							"Create your organization to unlock all features, or skip if you're waiting for an invitation.",
						)}
					</p>
				</div>

				<div className="space-y-6">
					{/* Create Organization Card */}
					<Card className={showCreateForm ? "border-primary/50" : ""}>
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

						{showCreateForm && (
							<CardContent>
								<form
									onSubmit={(e) => {
										e.preventDefault();
										form.handleSubmit();
									}}
									className="space-y-4"
								>
									{/* Organization Name */}
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
														{field.state.meta.errors[0]}
													</p>
												)}
											</div>
										)}
									</form.Field>

									{/* Organization Slug */}
									<form.Field
										name="slug"
										validators={{
											onChange: z
												.string()
												.min(2, "Slug must be at least 2 characters")
												.max(50, "Slug must be less than 50 characters")
												.regex(
													/^[a-z0-9-]+$/,
													"Slug must contain only lowercase letters, numbers, and hyphens",
												)
												.refine((slug) => !slug.startsWith("-") && !slug.endsWith("-"), {
													message: "Slug cannot start or end with a hyphen",
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
														{field.state.meta.errors[0]}
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
						)}
					</Card>

					{/* Skip Card */}
					<Card>
						<CardHeader>
							<CardTitle>
								{t("onboarding.organization.skipTitle", "Waiting for an Invitation?")}
							</CardTitle>
							<CardDescription>
								{t(
									"onboarding.organization.skipDescription",
									"If your administrator will invite you to an organization, you can skip this step for now.",
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
