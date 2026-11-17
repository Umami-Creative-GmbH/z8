"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { AuthFormWrapper } from "@/components/auth-form-wrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { getPostSignInRedirectUrl, sanitizeCallbackUrl } from "@/lib/auth/callback-url";
import { useDomainAuth } from "@/lib/auth/domain-auth-context";
import type { OrganizationBranding } from "@/lib/domain";
import { loadNativeAuthSession } from "@/lib/store-app/native-auth-session";
import { getStoreAppPlatform } from "@/lib/store-app/shell";
import { type StoreAppSignInResult, signInFromStoreApp } from "@/lib/store-app/store-app-sign-in";

type FailureReason = Extract<StoreAppSignInResult, { status: "failed" }>["reason"];
type Translate = ReturnType<typeof useTranslate>["t"];

function failureMessage(reason: FailureReason, t: Translate): string {
	switch (reason) {
		case "rate-limited":
			return t(
				"auth.storeApp.error.rateLimited",
				"Too many sign-in attempts. Please wait a moment and try again.",
			);
		case "unavailable":
			return t(
				"auth.storeApp.error.unavailable",
				"Z8 could not be reached. Check your connection and try again.",
			);
		case "browser":
			return t(
				"auth.storeApp.error.browser",
				"The sign-in page could not be opened. Please try again.",
			);
		default:
			return t(
				"auth.storeApp.error.expired",
				"Sign-in did not complete or has expired. Please try again.",
			);
	}
}

function emailError(errors: unknown[]): string | undefined {
	const [error] = errors;
	return typeof error === "string" ? error : undefined;
}

/**
 * The store app's email screen (#842). Signed-out users in the shell see it in
 * place of the sign-in form: the work email picks the sign-in domain, and
 * sign-in runs in the phone's system browser.
 */
export function StoreAppSignInForm() {
	const domain = useDomainAuth();
	const search = useSearchParams();
	return (
		<StoreAppSignInArrival
			key={JSON.stringify([domain, search.get("callbackUrl")])}
			branding={domain?.branding}
		/>
	);
}

function StoreAppSignInArrival({ branding }: { branding?: OrganizationBranding | null }) {
	const { t } = useTranslate();
	const searchParams = useSearchParams();
	const [error, setError] = useState<string | null>(null);
	const lifetime = useRef({ active: false, epoch: 0, busy: false });
	useEffect(() => {
		const owner = lifetime.current;
		owner.active = true;
		owner.busy = false;
		owner.epoch++;
		return () => {
			owner.active = false;
			owner.epoch++;
		};
	}, []);
	const form = useForm({
		onSubmitMeta: { epoch: 0 },
		defaultValues: { email: "" },
		onSubmit: async ({ value, meta: { epoch } }) => {
			const current = () => lifetime.current.active && lifetime.current.epoch === epoch;
			if (!current()) return;
			setError(null);
			try {
				const platform = getStoreAppPlatform();
				if (!platform) {
					setError(failureMessage("browser", t));
					return;
				}
				const openAuthSession = await loadNativeAuthSession(platform);
				if (!current()) return;
				const result = await signInFromStoreApp(value.email.trim(), {
					fetch: (input, init) => fetch(input, init),
					openAuthSession,
				});
				if (!current()) return;
				if (result.status === "signed-in") {
					const callbackUrl = sanitizeCallbackUrl(
						searchParams.get("callbackUrl"),
						"/init",
						window.location.href,
					);
					window.location.assign(getPostSignInRedirectUrl(callbackUrl));
					return;
				}
				if (result.status === "failed") setError(failureMessage(result.reason, t));
			} catch {
				if (current()) setError(failureMessage("browser", t));
			}
		},
	});

	const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

	return (
		<AuthFormWrapper
			branding={branding}
			formProps={{
				onSubmit: async (event) => {
					event.preventDefault();
					if (!lifetime.current.active || lifetime.current.busy) return;
					const element = event.currentTarget;
					lifetime.current.busy = true;
					const epoch = ++lifetime.current.epoch;
					await form.handleSubmit({ epoch });
					if (lifetime.current.active && lifetime.current.epoch === epoch) {
						lifetime.current.busy = false;
						if (!form.state.isValid)
							element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
					}
				},
			}}
			title={t("auth.storeApp.title", "Sign in to Z8")}
		>
			<p className="text-balance text-center text-muted-foreground text-sm">
				{t(
					"auth.storeApp.description",
					"Enter your work email. You then sign in on your organization's sign-in page in your phone's browser.",
				)}
			</p>
			{error ? (
				<div className="rounded-md bg-destructive/15 p-3 text-destructive text-sm" role="alert">
					{error}
				</div>
			) : null}
			<form.Field
				name="email"
				validators={{
					onSubmit: ({ value }) =>
						z.email().safeParse(value.trim()).success
							? undefined
							: t("validation.invalid-email", "Invalid email address"),
				}}
			>
				{(field) => {
					const fieldError = emailError(field.state.meta.errors);
					return (
						<TFormItem className="gap-3">
							<TFormLabel hasError={Boolean(fieldError)}>{t("auth.email", "Email")}</TFormLabel>
							<TFormControl hasError={Boolean(fieldError)}>
								<Input
									disabled={isSubmitting}
									autoCapitalize="none"
									autoComplete="email"
									inputMode="email"
									name={field.name}
									onBlur={field.handleBlur}
									onChange={(event) => {
										lifetime.current.epoch++;
										lifetime.current.busy = false;
										field.handleChange(event.target.value);
										setError(null);
									}}
									placeholder={t("auth.email-placeholder", "m@example.com")}
									required
									spellCheck={false}
									type="email"
									value={field.state.value}
								/>
							</TFormControl>
							<TFormMessage>{fieldError}</TFormMessage>
						</TFormItem>
					);
				}}
			</form.Field>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<Button className="w-full" disabled={isSubmitting} type="submit">
						{isSubmitting ? (
							<>
								<IconLoader2
									aria-hidden="true"
									className="mr-2 size-4 animate-spin motion-reduce:animate-none"
								/>
								{t("auth.storeApp.waiting", "Waiting for sign-in…")}
							</>
						) : (
							t("auth.storeApp.continue", "Continue")
						)}
					</Button>
				)}
			</form.Subscribe>
		</AuthFormWrapper>
	);
}
