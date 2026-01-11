"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconBuilding, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { checkSlugAvailability } from "@/app/[locale]/(app)/actions/organization";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	generateSlug,
	type OrganizationFormValues,
	organizationSchema,
} from "@/lib/validations/organization";
import { useRouter } from "@/navigation";
import { createOrganizationOnboarding, skipOrganizationSetup } from "./actions";

export default function OrganizationPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [checkingSlug, setCheckingSlug] = useState(false);
	const [slugError, setSlugError] = useState<string | null>(null);
	const [showCreateForm, _setShowCreateForm] = useState(true);

	const form = useForm<OrganizationFormValues>({
		resolver: zodResolver(organizationSchema),
		defaultValues: {
			name: "",
			slug: "",
		},
	});

	const name = form.watch("name");
	const slug = form.watch("slug");

	// Auto-generate slug from name
	useEffect(() => {
		if (name && !form.formState.dirtyFields.slug) {
			const generatedSlug = generateSlug(name);
			form.setValue("slug", generatedSlug, { shouldValidate: false });
		}
	}, [name, form]);

	// Validate slug availability (debounced)
	useEffect(() => {
		if (!slug || slug.length < 2) {
			setSlugError(null);
			return;
		}

		const slugFieldError = form.formState.errors.slug;
		if (slugFieldError) {
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
	}, [slug, form.formState.errors.slug, t]);

	async function onSubmit(values: OrganizationFormValues) {
		if (slugError) {
			return;
		}

		setLoading(true);

		const result = await createOrganizationOnboarding(values);

		setLoading(false);

		if (result.success) {
			toast.success(t("organization.createSuccess", "Organization created successfully!"));
			router.push("/onboarding/profile");
		} else {
			toast.error(result.error || t("organization.createError", "Failed to create organization"));
		}
	}

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
								<Form {...form}>
									<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
										{/* Organization Name */}
										<FormField
											control={form.control}
											name="name"
											render={({ field }) => (
												<FormItem>
													<FormLabel>{t("organization.nameLabel", "Organization Name")}</FormLabel>
													<FormControl>
														<Input
															{...field}
															placeholder={t("organization.namePlaceholder", "Acme Inc.")}
															disabled={loading}
														/>
													</FormControl>
													<FormMessage />
												</FormItem>
											)}
										/>

										{/* Organization Slug */}
										<FormField
											control={form.control}
											name="slug"
											render={({ field }) => (
												<FormItem>
													<FormLabel>{t("organization.slugLabel", "Organization Slug")}</FormLabel>
													<FormControl>
														<div className="relative">
															<Input
																{...field}
																placeholder={t("organization.slugPlaceholder", "acme-inc")}
																disabled={loading}
																onChange={(e) => {
																	field.onChange(e);
																	form.trigger("slug");
																}}
															/>
															{checkingSlug && (
																<div className="absolute right-3 top-1/2 -translate-y-1/2">
																	<IconLoader2 className="size-4 animate-spin text-muted-foreground" />
																</div>
															)}
														</div>
													</FormControl>
													<FormDescription>
														{t(
															"organization.slugDescription",
															"Used in URLs. Auto-generated from name.",
														)}
													</FormDescription>
													{slugError && (
														<p className="text-sm font-medium text-destructive">{slugError}</p>
													)}
													<FormMessage />
												</FormItem>
											)}
										/>

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
								</Form>
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
