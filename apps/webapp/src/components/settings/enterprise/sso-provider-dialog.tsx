"use client";

import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type OIDCProviderInput,
	registerSSOProviderAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SSOProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onProviderAdded: (provider: {
		id: string;
		issuer: string;
		domain: string;
		providerId: string;
		domainVerified: boolean | null;
		domainVerificationToken: string | null;
		createdAt: Date | null;
	}) => void;
}

const DOMAIN_REGEX = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;

export function SSOProviderDialog({ open, onOpenChange, onProviderAdded }: SSOProviderDialogProps) {
	const { t } = useTranslate();
	const [isSubmitting, setIsSubmitting] = useState(false);

	const form = useForm({
		defaultValues: {
			providerId: "",
			issuer: "",
			domain: "",
			clientId: "",
			clientSecret: "",
		},
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			const result = await registerSSOProviderAction(value as OIDCProviderInput).then(
				(response) => ({ ok: true as const, response }),
				(error) => ({ ok: false as const, error }),
			);

			if (!result.ok) {
				if (result.error instanceof Error) {
					toast.error(result.error.message);
				} else {
					toast.error(t("settings.enterprise.sso.addError", "Failed to add SSO provider"));
				}
				setIsSubmitting(false);
				return;
			}

			onProviderAdded(result.response);
			toast.success(t("settings.enterprise.sso.addSuccess", "SSO provider added successfully"));
			form.reset();
			onOpenChange(false);
			setIsSubmitting(false);
		},
	});

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.enterprise.sso.addTitle", "Add SSO Provider")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.enterprise.sso.addDescription",
							"Configure an OIDC identity provider for enterprise single sign-on.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						<form.Field
							name="providerId"
							validators={{
								onChange: ({ value }) => {
									if (!value)
										return t(
											"settings.enterprise.sso.providerIdRequired",
											"Provider ID is required",
										);
									if (!PROVIDER_ID_REGEX.test(value)) {
										return t(
											"settings.enterprise.sso.providerIdInvalid",
											"Provider ID must contain only lowercase letters, numbers, and hyphens",
										);
									}
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="providerId">
										{t("settings.enterprise.sso.providerId", "Provider ID")}
									</Label>
									<Input
										id="providerId"
										placeholder="acme-okta"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.enterprise.sso.providerIdHelp",
											"A unique identifier for this provider (lowercase, no spaces)",
										)}
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="issuer"
							validators={{
								onChange: ({ value }) => {
									if (!value)
										return t("settings.enterprise.sso.issuerUrlRequired", "Issuer URL is required");
									try {
										new URL(value);
									} catch {
										return t(
											"settings.enterprise.sso.validUrlRequired",
											"Please enter a valid URL",
										);
									}
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="issuer">
										{t("settings.enterprise.sso.issuerUrl", "Issuer URL")}
									</Label>
									<Input
										id="issuer"
										type="url"
										placeholder="https://example.okta.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.enterprise.sso.issuerUrlHelp",
											"The OIDC issuer URL from your identity provider",
										)}
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="domain"
							validators={{
								onChange: ({ value }) => {
									if (!value)
										return t("settings.enterprise.sso.domainRequired", "Domain is required");
									if (!DOMAIN_REGEX.test(value)) {
										return t(
											"settings.enterprise.sso.domainInvalid",
											"Please enter a valid domain (e.g., example.com)",
										);
									}
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="domain">
										{t("settings.enterprise.sso.emailDomain", "Email Domain")}
									</Label>
									<Input
										id="domain"
										placeholder="example.com"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.enterprise.sso.emailDomainHelp",
											"Users with this email domain will be able to use SSO",
										)}
									</p>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="clientId"
							validators={{
								onChange: ({ value }) => {
									if (!value)
										return t("settings.enterprise.clientIdRequired", "Client ID is required");
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="clientId">{t("settings.enterprise.clientId", "Client ID")}</Label>
									<Input
										id="clientId"
										placeholder={t(
											"settings.enterprise.sso.clientIdPlaceholder",
											"Your OIDC client ID",
										)}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="clientSecret"
							validators={{
								onChange: ({ value }) => {
									if (!value)
										return t(
											"settings.enterprise.clientSecretRequired",
											"Client Secret is required",
										);
									return undefined;
								},
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label htmlFor="clientSecret">
										{t("settings.enterprise.clientSecret", "Client Secret")}
									</Label>
									<Input
										id="clientSecret"
										type="password"
										placeholder={t(
											"settings.enterprise.sso.clientSecretPlaceholder",
											"Your OIDC client secret",
										)}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm text-destructive">{field.state.meta.errors[0]}</p>
									)}
								</div>
							)}
						</form.Field>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting
								? t("common.adding", "Adding...")
								: t("settings.enterprise.addProvider", "Add Provider")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
