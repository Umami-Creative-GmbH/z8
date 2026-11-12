"use client";

import { actionData } from "@/components/settings/enterprise/action-data";
import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { registerSSOProviderAction } from "@/app/[locale]/(app)/settings/enterprise/actions";
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
import { getEntraIssuer } from "@/lib/enterprise-identity/entra-setup";
import type { SsoSetupKind } from "./sso-guide-content";
import { SsoProviderGuide } from "./sso-provider-guide";
import type { SsoProvider } from "./sso-provider-list-card";

interface SSOProviderDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onProviderAdded: (provider: SsoProvider) => void;
	callbackUrl: string;
}

const DOMAIN_REGEX =
	/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const PROVIDER_ID_REGEX = /^[a-z0-9-]+$/;

export function SSOProviderDialog({
	open,
	onOpenChange,
	onProviderAdded,
	callbackUrl,
}: SSOProviderDialogProps) {
	const { t } = useTranslate();
	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.enterprise.sso.addTitle", "Add SSO Provider")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.enterprise.sso.guide.addDescription",
							"Follow your provider's setup instructions, then connect it to your organization.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				{open ? (
					<SsoProviderSetup
						callbackUrl={callbackUrl}
						onProviderAdded={onProviderAdded}
						onOpenChange={onOpenChange}
					/>
				) : null}
			</ActionPanelContent>
		</ActionPanel>
	);
}

function SsoProviderSetup(
	props: Pick<
		SSOProviderDialogProps,
		"callbackUrl" | "onProviderAdded" | "onOpenChange"
	>,
) {
	const [kind, setKind] = useState<SsoSetupKind>("microsoft-entra");
	return (
		<SsoProviderForm key={kind} kind={kind} onKindChange={setKind} {...props} />
	);
}

interface SsoProviderFormProps {
	kind: SsoSetupKind;
	onKindChange: (kind: SsoSetupKind) => void;
	callbackUrl: string;
	onProviderAdded: SSOProviderDialogProps["onProviderAdded"];
	onOpenChange: SSOProviderDialogProps["onOpenChange"];
}

function useSsoProviderForm({
	kind,
	onProviderAdded,
	onOpenChange,
}: Pick<SsoProviderFormProps, "kind" | "onProviderAdded" | "onOpenChange">) {
	const formRef = useRef<HTMLFormElement>(null);
	const { t } = useTranslate();
	const [generatedProviderId] = useState(() => `entra-${crypto.randomUUID()}`);
	const isEntra = kind === "microsoft-entra";

	const form = useForm({
		defaultValues: {
			providerId: "",
			issuer: "",
			tenantId: "",
			domain: "",
			clientId: "",
			clientSecret: "",
		},
		onSubmitInvalid: () => {
			requestAnimationFrame(() =>
				formRef.current
					?.querySelector<HTMLElement>('[aria-invalid="true"]')
					?.focus(),
			);
		},
		onSubmit: async ({ value }) => {
			const issuer = isEntra
				? getEntraIssuer(value.tenantId)
				: value.issuer.trim();
			if (!issuer) return;
			try {
				const provider = await actionData(registerSSOProviderAction({
					providerId: isEntra ? generatedProviderId : value.providerId.trim(),
					issuer,
					domain: value.domain.trim().toLowerCase(),
					clientId: value.clientId.trim(),
					clientSecret: value.clientSecret.trim(),
				}));
				onProviderAdded(provider);
				toast.success(
					t(
						"settings.enterprise.sso.addSuccess",
						"SSO provider added successfully",
					),
				);
				form.reset();
				onOpenChange(false);
			} catch (error) {
				toast.error(
					error instanceof Error
						? error.message
						: t(
								"settings.enterprise.sso.addError",
								"Failed to add SSO provider",
							),
				);
			}
		},
	});
	return { form, formRef };
}

type SsoFormApi = ReturnType<typeof useSsoProviderForm>["form"];

function SsoProviderForm({
	kind,
	onKindChange,
	callbackUrl,
	onProviderAdded,
	onOpenChange,
}: SsoProviderFormProps) {
	const { t } = useTranslate();
	const { form, formRef } = useSsoProviderForm({
		kind,
		onProviderAdded,
		onOpenChange,
	});
	return (
		<form
			ref={formRef}
			action={() => form.handleSubmit()}
			className="flex min-h-0 flex-1 flex-col"
		>
			<ActionPanelBody className="space-y-6">
				<div className="space-y-2">
					<Label htmlFor="sso-setup-provider">
						{t("settings.enterprise.sso.guide.provider", "Identity provider")}
					</Label>
					<Select
						value={kind}
						onValueChange={(value) => {
							if (value === "microsoft-entra" || value === "generic")
								onKindChange(value);
						}}
					>
						<SelectTrigger id="sso-setup-provider" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="microsoft-entra">
								Microsoft Entra ID
							</SelectItem>
							<SelectItem value="generic">
								{t(
									"settings.enterprise.sso.guide.manual",
									"Other provider / manual OIDC",
								)}
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="grid min-w-0 items-start gap-6 md:grid-cols-2">
					<SsoConnectionFields form={form} kind={kind} />
					<form.Subscribe selector={(state) => state.values.domain}>
						{(domain) => (
							<SsoProviderGuide
								kind={kind}
								callbackUrl={callbackUrl}
								domain={domain.trim()}
							/>
						)}
					</form.Subscribe>
				</div>
			</ActionPanelBody>
			<ActionPanelFooter>
				<Button
					type="button"
					variant="outline"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel", "Cancel")}
				</Button>
				<form.Subscribe selector={(state) => state.isSubmitting}>
					{(submitting) => (
						<Button type="submit" disabled={submitting}>
							{submitting ? (
								<IconLoader2
									className="size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : null}
							{submitting
								? t("settings.enterprise.sso.guide.saving", "Adding…")
								: t("settings.enterprise.addProvider", "Add Provider")}
						</Button>
					)}
				</form.Subscribe>
			</ActionPanelFooter>
		</form>
	);
}

function SsoConnectionFields({
	form,
	kind,
}: {
	form: SsoFormApi;
	kind: SsoSetupKind;
}) {
	const { t } = useTranslate();
	const isEntra = kind === "microsoft-entra";
	const required = ({ value }: { value: string }) =>
		value.trim()
			? undefined
			: t("settings.enterprise.sso.guide.required", "This field is required.");
	return (
		<div className="min-w-0 space-y-5">
			<div className="space-y-1">
				<h3 className="text-sm font-semibold">
					{t(
						"settings.enterprise.sso.guide.connectionSettings",
						"Connection settings",
					)}
				</h3>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.enterprise.sso.guide.connectionHelp",
						"Copy these values from your provider's application settings.",
					)}
				</p>
			</div>
			<form.Field
				name="domain"
				validators={{
					onChange: ({ value }) =>
						DOMAIN_REGEX.test(value.trim())
							? undefined
							: t(
									"settings.enterprise.sso.domainInvalid",
									"Please enter a valid domain (e.g., example.com)",
								),
				}}
			>
				{(field) => (
					<SsoTextField
						field={field}
						label={t("settings.enterprise.sso.emailDomain", "Email Domain")}
						placeholder="example.com"
						description={t(
							"settings.enterprise.sso.emailDomainHelp",
							"Users with this email domain will be able to use SSO",
						)}
					/>
				)}
			</form.Field>
			{isEntra ? (
				<>
					<form.Field
						name="tenantId"
						validators={{
							onChange: ({ value }) =>
								getEntraIssuer(value)
									? undefined
									: t(
											"settings.enterprise.sso.guide.entra.tenantInvalid",
											"Enter the Directory (tenant) ID as a complete UUID.",
										),
						}}
					>
						{(field) => (
							<SsoTextField
								field={field}
								label={t(
									"settings.enterprise.sso.guide.entra.tenantId",
									"Directory (tenant) ID",
								)}
								description={t(
									"settings.enterprise.sso.guide.entra.tenantHelp",
									"App registrations → your app → Overview. Use your tenant ID, not common or organizations.",
								)}
							/>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.tenantId}>
						{(tenantId) => {
							const issuer = getEntraIssuer(tenantId);
							return issuer ? (
								<div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
									<p className="mb-1 font-medium">
										{t(
											"settings.enterprise.sso.guide.entra.generatedIssuer",
											"Issuer URL · generated from your tenant ID",
										)}
									</p>
									<code className="break-all">{issuer}</code>
								</div>
							) : null;
						}}
					</form.Subscribe>
				</>
			) : (
				<>
					<form.Field
						name="providerId"
						validators={{
							onChange: ({ value }) =>
								PROVIDER_ID_REGEX.test(value)
									? undefined
									: t(
											"settings.enterprise.sso.providerIdInvalid",
											"Provider ID must contain only lowercase letters, numbers, and hyphens",
										),
						}}
					>
						{(field) => (
							<SsoTextField
								field={field}
								label={t("settings.enterprise.sso.providerId", "Provider ID")}
								placeholder="acme-oidc"
								description={t(
									"settings.enterprise.sso.providerIdHelp",
									"A unique identifier for this provider (lowercase, no spaces)",
								)}
							/>
						)}
					</form.Field>
					<form.Field
						name="issuer"
						validators={{
							onChange: ({ value }) => {
								try {
									new URL(value);
									return undefined;
								} catch {
									return t(
										"settings.enterprise.sso.validUrlRequired",
										"Please enter a valid URL",
									);
								}
							},
						}}
					>
						{(field) => (
							<SsoTextField
								field={field}
								label={t("settings.enterprise.sso.issuerUrl", "Issuer URL")}
								type="url"
								placeholder="https://idp.example.com"
								description={t(
									"settings.enterprise.sso.issuerUrlHelp",
									"The OIDC issuer URL from your identity provider",
								)}
							/>
						)}
					</form.Field>
				</>
			)}
			<form.Field name="clientId" validators={{ onChange: required }}>
				{(field) => (
					<SsoTextField
						field={field}
						label={
							isEntra
								? t(
										"settings.enterprise.sso.guide.entra.clientId",
										"Application (client) ID",
									)
								: t("settings.enterprise.clientId", "Client ID")
						}
						description={
							isEntra
								? t(
										"settings.enterprise.sso.guide.entra.clientHelp",
										"Copy Application (client) ID from Overview, not Object ID.",
									)
								: undefined
						}
					/>
				)}
			</form.Field>
			<form.Field name="clientSecret" validators={{ onChange: required }}>
				{(field) => (
					<SsoTextField
						field={field}
						type="password"
						label={
							isEntra
								? t(
										"settings.enterprise.sso.guide.entra.secretValue",
										"Client secret Value",
									)
								: t("settings.enterprise.clientSecret", "Client Secret")
						}
						description={
							isEntra
								? t(
										"settings.enterprise.sso.guide.entra.secretHelp",
										"Certificates & secrets → Client secrets. Paste the Value, not the Secret ID. Z8 will not display it again.",
									)
								: undefined
						}
					/>
				)}
			</form.Field>
		</div>
	);
}

interface TextFieldApi {
	name: string;
	state: { value: string; meta: { errors: unknown[] } };
	handleChange: (value: string) => void;
	handleBlur: () => void;
}
function SsoTextField({
	field,
	label,
	description,
	placeholder,
	type = "text",
}: {
	field: TextFieldApi;
	label: string;
	description?: string;
	placeholder?: string;
	type?: "text" | "password" | "url";
}) {
	const hasError = field.state.meta.errors.length > 0;
	return (
		<TFormItem>
			<TFormLabel hasError={hasError}>{label}</TFormLabel>
			<TFormControl hasError={hasError}>
				<Input
					name={field.name}
					type={type}
					autoComplete="off"
					spellCheck={false}
					placeholder={placeholder}
					value={field.state.value}
					onChange={(event) => field.handleChange(event.target.value)}
					onBlur={field.handleBlur}
				/>
			</TFormControl>
			<TFormDescription>{description}</TFormDescription>
			<TFormMessage field={field} />
		</TFormItem>
	);
}
