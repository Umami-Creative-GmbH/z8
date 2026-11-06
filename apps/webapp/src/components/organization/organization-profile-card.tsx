"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveOrganizationProfile } from "@/app/[locale]/(app)/settings/organization/profile-actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { fieldSurfaceClassName } from "@/components/ui/field-trigger";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import {
	type OrganizationProfile,
	PROFILE_COUNTRIES,
	type ProfileFieldErrors,
	validateOrganizationProfile,
} from "@/lib/organization/profile";
import { useRouter } from "@/navigation";

export function OrganizationProfileCard({
	organizationId,
	profile,
}: {
	organizationId: string;
	profile: OrganizationProfile;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	const formElement = useRef<HTMLFormElement>(null);
	const focusErrors = useRef(false);
	const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
	const [feedback, setFeedback] = useState<"saved" | "error" | null>(null);
	const [savedProfile, setSavedProfile] = useState(profile);
	const form = useForm({
		defaultValues: savedProfile,
		onSubmit: async ({ value }) => {
			setFeedback(null);
			const validation = validateOrganizationProfile(value);
			if (!validation.ok) {
				focusErrors.current = true;
				setFieldErrors(validation.fieldErrors);
				return;
			}
			try {
				const result = await saveOrganizationProfile(
					organizationId,
					validation.profile,
				);
				if (!result.success) {
					setFeedback("error");
				} else if (!result.data.ok) {
					focusErrors.current = true;
					setFieldErrors(result.data.fieldErrors);
				} else {
					setFieldErrors({});
					setSavedProfile(result.data.profile);
					form.reset(result.data.profile);
					setFeedback("saved");
					router.refresh();
				}
			} catch {
				setFeedback("error");
			}
		},
	});
	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
	const hasUnsavedChanges = useStore(
		form.store,
		(state) => !state.isDefaultValue,
	);
	useEffect(() => {
		if (!hasUnsavedChanges) return;
		const warn = (event: BeforeUnloadEvent) => {
			event.preventDefault();
			// Older browsers require returnValue to display their native warning.
			event.returnValue = "";
		};
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [hasUnsavedChanges]);
	useEffect(() => {
		if (isSubmitting || !focusErrors.current) return;
		focusErrors.current = false;
		const firstError = Object.keys(fieldErrors).find(
			(name) => fieldErrors[name as keyof OrganizationProfile],
		);
		if (firstError)
			formElement.current
				?.querySelector<HTMLElement>(`[name="${firstError}"]`)
				?.focus();
	}, [fieldErrors, isSubmitting]);
	const countries = useMemo(() => {
		const names = new Intl.DisplayNames([locale], { type: "region" });
		return PROFILE_COUNTRIES.map((code) => ({
			code,
			name: names.of(code) ?? code,
		})).sort((a, b) => a.name.localeCompare(b.name, locale));
	}, [locale]);
	const labels = {
		legalCompanyName: t(
			"organization.profile.legalCompanyName",
			"Legal company name",
		),
		addressLine1: t("organization.profile.addressLine1", "Address line 1"),
		addressLine2: t(
			"organization.profile.addressLine2",
			"Address line 2 (optional)",
		),
		postalCode: t("organization.profile.postalCode", "Postal code"),
		city: t("organization.profile.city", "City"),
		stateOrRegion: t(
			"organization.profile.stateOrRegion",
			"State or region (optional)",
		),
		country: t("organization.profile.country", "Country"),
		vatId: t("organization.profile.vatId", "VAT ID (optional)"),
	};
	const errors = {
		invalidText: t(
			"organization.profile.invalidText",
			"Enter text without control characters.",
		),
		tooLong: t(
			"organization.profile.tooLong",
			"This value is too long. Shorten it and try again.",
		),
		invalidCountry: t(
			"organization.profile.invalidCountry",
			"Choose a country from the list.",
		),
		invalidVatId: t(
			"organization.profile.invalidVatId",
			"Enter a VAT ID with a two-letter country prefix and 2–14 letters or digits, for example DE123456789.",
		),
	};
	const autocomplete = {
		legalCompanyName: "organization",
		addressLine1: "address-line1",
		addressLine2: "address-line2",
		postalCode: "postal-code",
		city: "address-level2",
		stateOrRegion: "address-level1",
		country: "country",
		vatId: "off",
	};
	return (
		<Card id="organization-profile">
			<CardHeader>
				<CardTitle>
					{t("organization.profile.title", "Organization profile")}
				</CardTitle>
				<CardDescription>
					{t(
						"organization.profile.description",
						"Maintain your legal company name and registered address. You can save an empty or partial profile. These details are separate from your organization display name, workplace settings and subscription billing.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					ref={formElement}
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
					className="space-y-4"
				>
					<fieldset
						disabled={isSubmitting}
						className="grid min-w-0 gap-4 sm:grid-cols-2"
					>
						<legend className="sr-only">
							{t(
								"organization.profile.fields",
								"Legal identity and registered address",
							)}
						</legend>
						{(Object.keys(labels) as (keyof OrganizationProfile)[]).map(
							(name) => (
								<form.Field key={name} name={name}>
									{(field) => (
										<TFormItem
											className={
												name === "legalCompanyName" || name === "vatId"
													? "sm:col-span-2"
													: undefined
											}
										>
											<TFormLabel hasError={!!fieldErrors[name]}>
												{labels[name]}
											</TFormLabel>
											<TFormControl hasError={!!fieldErrors[name]}>
												{name === "country" ? (
													<select
														aria-label={labels[name]}
														className={`${fieldSurfaceClassName} h-9 w-full bg-card px-3 text-card-foreground text-sm dark:bg-card`}
														name={name}
														autoComplete={autocomplete[name]}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(event) => {
															field.handleChange(event.target.value);
															setFieldErrors((current) => ({
																...current,
																[name]: undefined,
															}));
															setFeedback(null);
														}}
													>
														<option value="">
															{t(
																"organization.profile.chooseCountry",
																"Choose a country",
															)}
														</option>
														{countries.map(({ code, name }) => (
															<option key={code} value={code}>
																{name}
															</option>
														))}
													</select>
												) : (
													<Input
														name={name}
														spellCheck={name === "vatId" ? false : undefined}
														autoComplete={autocomplete[name]}
														value={field.state.value}
														onBlur={field.handleBlur}
														onChange={(event) => {
															field.handleChange(event.target.value);
															setFieldErrors((current) => ({
																...current,
																[name]: undefined,
															}));
															setFeedback(null);
														}}
													/>
												)}
											</TFormControl>
											<TFormDescription>
												{name === "vatId"
													? t(
															"organization.profile.vatHint",
															"Basic format check only. Z8 does not verify VAT registration with an external service.",
														)
													: t(
															"organization.profile.partialHint",
															"May be left empty.",
														)}
											</TFormDescription>
											<TFormMessage>
												{fieldErrors[name] ? errors[fieldErrors[name]] : null}
											</TFormMessage>
										</TFormItem>
									)}
								</form.Field>
							),
						)}
					</fieldset>
					<Button type="submit" disabled={isSubmitting}>
						{isSubmitting
							? t("organization.profile.saving", "Saving…")
							: t("organization.profile.save", "Save profile")}
					</Button>
					{feedback === "saved" ? (
						<p role="status" className="text-sm text-muted-foreground">
							{t("organization.profile.saved", "Organization profile saved")}
						</p>
					) : null}
					{feedback === "error" ? (
						<p role="alert" className="text-sm text-destructive">
							{t(
								"organization.profile.saveFailed",
								"Could not save the organization profile. Please try again.",
							)}
						</p>
					) : null}
				</form>
			</CardContent>
		</Card>
	);
}
