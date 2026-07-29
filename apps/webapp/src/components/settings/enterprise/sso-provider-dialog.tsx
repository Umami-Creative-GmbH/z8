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

const DOMAIN_REGEX =
	/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;

function useSsoProviderForm({
	onOpenChange,
	onProviderAdded,
}: Pick<SSOProviderDialogProps, "onOpenChange" | "onProviderAdded">) {
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
			const result = await registerSSOProviderAction(
				value as OIDCProviderInput,
			).then(
				(response) => ({ ok: true as const, response }),
				(error) => ({ ok: false as const, error }),
			);
			if (!result.ok) {
				if (result.error instanceof Error) toast.error(result.error.message);
				else
					toast.error(
						t("settings.enterprise.sso.addError", "Failed to add SSO provider"),
					);
				setIsSubmitting(false);
				return;
			}

			onProviderAdded(result.response);
			toast.success(
				t(
					"settings.enterprise.sso.addSuccess",
					"SSO provider added successfully",
				),
			);
			form.reset();
			onOpenChange(false);
			setIsSubmitting(false);
		},
	});

	return { form, isSubmitting };
}

type SsoProviderFormApi = ReturnType<typeof useSsoProviderForm>["form"];

export function SSOProviderDialog(props: SSOProviderDialogProps) {
	const { open, onOpenChange } = props;
	const { t } = useTranslate();
	const { form, isSubmitting } = useSsoProviderForm(props);

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
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
					className="flex min-h-0 flex-1 flex-col"
				>
					<ActionPanelBody className="space-y-4">
						<SsoProviderIdentityFields form={form} />
						<SsoProviderCredentialFields form={form} />
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
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

function SsoProviderIdentityFields({ form }: { form: SsoProviderFormApi }) {
	const { t } = useTranslate();
	return (
		<>
			<form.Field
				name="providerId"
				validators={{
					onChange: ({ value }) => {
						if (!value)
							return t(
								"settings.enterprise.sso.providerIdRequired",
								"Provider ID is required",
							);
						if (!PROVIDER_ID_REGEX.test(value))
							return t(
								"settings.enterprise.sso.providerIdInvalid",
								"Provider ID must contain only lowercase letters, numbers, and hyphens",
							);
						return undefined;
					},
				}}
			>
				{(field) => (
					<SsoTextField
						id="providerId"
						label={t("settings.enterprise.sso.providerId", "Provider ID")}
						placeholder="acme-okta"
						value={field.state.value}
						onChange={field.handleChange}
						onBlur={field.handleBlur}
						help={t(
							"settings.enterprise.sso.providerIdHelp",
							"A unique identifier for this provider (lowercase, no spaces)",
						)}
						errors={field.state.meta.errors}
					/>
				)}
			</form.Field>
			<form.Field
				name="issuer"
				validators={{
					onChange: ({ value }) => {
						if (!value)
							return t(
								"settings.enterprise.sso.issuerUrlRequired",
								"Issuer URL is required",
							);
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
					<SsoTextField
						id="issuer"
						type="url"
						label={t("settings.enterprise.sso.issuerUrl", "Issuer URL")}
						placeholder="https://example.okta.com"
						value={field.state.value}
						onChange={field.handleChange}
						onBlur={field.handleBlur}
						help={t(
							"settings.enterprise.sso.issuerUrlHelp",
							"The OIDC issuer URL from your identity provider",
						)}
						errors={field.state.meta.errors}
					/>
				)}
			</form.Field>
			<form.Field
				name="domain"
				validators={{
					onChange: ({ value }) => {
						if (!value)
							return t(
								"settings.enterprise.sso.domainRequired",
								"Domain is required",
							);
						if (!DOMAIN_REGEX.test(value))
							return t(
								"settings.enterprise.sso.domainInvalid",
								"Please enter a valid domain (e.g., example.com)",
							);
						return undefined;
					},
				}}
			>
				{(field) => (
					<SsoTextField
						id="domain"
						label={t("settings.enterprise.sso.emailDomain", "Email Domain")}
						placeholder="example.com"
						value={field.state.value}
						onChange={field.handleChange}
						onBlur={field.handleBlur}
						help={t(
							"settings.enterprise.sso.emailDomainHelp",
							"Users with this email domain will be able to use SSO",
						)}
						errors={field.state.meta.errors}
					/>
				)}
			</form.Field>
		</>
	);
}

function SsoProviderCredentialFields({ form }: { form: SsoProviderFormApi }) {
	const { t } = useTranslate();
	return (
		<>
			<form.Field
				name="clientId"
				validators={{
					onChange: ({ value }) =>
						value
							? undefined
							: t(
									"settings.enterprise.clientIdRequired",
									"Client ID is required",
								),
				}}
			>
				{(field) => (
					<SsoTextField
						id="clientId"
						label={t("settings.enterprise.clientId", "Client ID")}
						placeholder={t(
							"settings.enterprise.sso.clientIdPlaceholder",
							"Your OIDC client ID",
						)}
						value={field.state.value}
						onChange={field.handleChange}
						onBlur={field.handleBlur}
						errors={field.state.meta.errors}
					/>
				)}
			</form.Field>
			<form.Field
				name="clientSecret"
				validators={{
					onChange: ({ value }) =>
						value
							? undefined
							: t(
									"settings.enterprise.clientSecretRequired",
									"Client Secret is required",
								),
				}}
			>
				{(field) => (
					<SsoTextField
						id="clientSecret"
						type="password"
						label={t("settings.enterprise.clientSecret", "Client Secret")}
						placeholder={t(
							"settings.enterprise.sso.clientSecretPlaceholder",
							"Your OIDC client secret",
						)}
						value={field.state.value}
						onChange={field.handleChange}
						onBlur={field.handleBlur}
						errors={field.state.meta.errors}
					/>
				)}
			</form.Field>
		</>
	);
}

function SsoTextField({
	id,
	type,
	label,
	placeholder,
	value,
	onChange,
	onBlur,
	help,
	errors,
}: {
	id: string;
	type?: "text" | "url" | "password";
	label: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
	onBlur: () => void;
	help?: string;
	errors: unknown[];
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type={type}
				placeholder={placeholder}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				onBlur={onBlur}
			/>
			{help && <p className="text-sm text-muted-foreground">{help}</p>}
			{errors.length > 0 && (
				<p className="text-sm text-destructive">{errors[0] as string}</p>
			)}
		</div>
	);
}
