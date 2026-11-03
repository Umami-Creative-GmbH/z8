"use client";

import {
	IconBook2,
	IconCheck,
	IconCopy,
	IconExternalLink,
	IconInfoCircle,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	buildSsoHandoffChecklist,
	getSsoGuideContent,
	type SsoSetupKind,
} from "./sso-guide-content";

export function CopySetupButton({
	value,
	label,
}: {
	value: string;
	label: string;
}) {
	const { t } = useTranslate();
	const [copiedValue, setCopiedValue] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const copied = copiedValue === value;
	return (
		<div className="space-y-1">
			<Button
				type="button"
				size="sm"
				variant="outline"
				onClick={async () => {
					setFailed(false);
					setCopiedValue(null);
					try {
						await navigator.clipboard.writeText(value);
						setCopiedValue(value);
					} catch {
						setFailed(true);
					}
				}}
			>
				{copied ? (
					<IconCheck className="size-4" aria-hidden="true" />
				) : (
					<IconCopy className="size-4" aria-hidden="true" />
				)}
				{label}
			</Button>
			<span role="status" className="sr-only">
				{copied
					? t("settings.enterprise.sso.guide.copied", "Copied to clipboard")
					: ""}
			</span>
			{failed ? (
				<div className="space-y-2">
					<p role="alert" className="text-xs text-destructive">
						{t(
							"settings.enterprise.sso.guide.copyFailed",
							"Clipboard access failed. Select and copy the text manually.",
						)}
					</p>
					<textarea
						aria-label={label}
						readOnly
						value={value}
						rows={5}
						autoComplete="off"
						spellCheck={false}
						className="w-full rounded-md border bg-background p-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
					/>
				</div>
			) : null}
		</div>
	);
}

export function SsoCallbackUrl({ callbackUrl }: { callbackUrl: string }) {
	const { t } = useTranslate();
	return (
		<div className="space-y-3 rounded-lg border bg-background p-4">
			<p className="text-sm font-medium">
				{t("settings.enterprise.sso.guide.callback", "Z8 callback URL")}
			</p>
			<code
				translate="no"
				className="block break-all text-xs leading-relaxed text-muted-foreground"
			>
				{callbackUrl}
			</code>
			<CopySetupButton
				value={callbackUrl}
				label={t(
					"settings.enterprise.sso.guide.copyCallback",
					"Copy callback URL",
				)}
			/>
		</div>
	);
}

export function SsoProviderGuide({
	kind,
	callbackUrl,
	domain,
}: {
	kind: SsoSetupKind;
	callbackUrl: string;
	domain?: string;
}) {
	const { t } = useTranslate();
	const guide = getSsoGuideContent(kind, t);
	return (
		<aside
			aria-label={guide.title}
			className="min-w-0 space-y-5 rounded-xl border bg-muted/30 p-4 sm:p-5"
		>
			<div className="space-y-2">
				<div className="flex items-center gap-2 text-primary">
					<IconBook2 className="size-4 shrink-0" aria-hidden="true" />
					<h3 className="text-sm font-semibold text-pretty">{guide.title}</h3>
				</div>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{guide.description}
				</p>
			</div>
			<SsoCallbackUrl callbackUrl={callbackUrl} />
			<ol className="space-y-5">
				{guide.steps.map((step, index) => (
					<li key={step.title} className="flex items-start gap-3">
						<span
							aria-hidden="true"
							className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-background text-xs font-semibold text-primary"
						>
							{index + 1}
						</span>
						<div className="min-w-0 space-y-1.5">
							<h4 className="text-sm font-medium">{step.title}</h4>
							<p className="text-sm leading-relaxed text-muted-foreground">
								{step.description}
							</p>
							{step.href ? (
								<a
									href={step.href}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
								>
									{step.linkLabel}
									<IconExternalLink
										className="size-3.5 shrink-0"
										aria-hidden="true"
									/>
								</a>
							) : null}
						</div>
					</li>
				))}
			</ol>
			{kind === "microsoft-entra" ? (
				<div className="space-y-2 text-sm leading-relaxed text-muted-foreground">
					<p>
						{t(
							"settings.enterprise.sso.guide.entra.permissions",
							"Z8 uses openid, email, and profile for sign-in. Some connections also request offline_access for refresh tokens. You do not need directory-wide Microsoft Graph permissions. Your tenant's consent policy may still require administrator approval.",
						)}
					</p>
					<a
						className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
						href="https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/user-admin-consent-overview"
						target="_blank"
						rel="noopener noreferrer"
					>
						{t(
							"settings.enterprise.sso.guide.entra.consentLink",
							"Microsoft's consent guidance",
						)}
					</a>
				</div>
			) : null}
			<div className="space-y-3 border-t pt-5">
				<h4 className="text-sm font-medium">
					{t(
						"settings.enterprise.sso.guide.handoff.title",
						"Need help from your IT administrator?",
					)}
				</h4>
				<p className="text-sm leading-relaxed text-muted-foreground">
					{t(
						"settings.enterprise.sso.guide.handoff.description",
						"Copy the setup instructions and your organization's callback URL. The checklist never includes credentials.",
					)}
				</p>
				<CopySetupButton
					value={buildSsoHandoffChecklist({ kind, callbackUrl, domain, t })}
					label={t(
						"settings.enterprise.sso.guide.handoff.copy",
						"Copy IT checklist",
					)}
				/>
			</div>
			<SsoSetupNextSteps />
			{kind === "microsoft-entra" ? <EntraTroubleshooting /> : null}
		</aside>
	);
}

export function SsoSetupNextSteps() {
	const { t } = useTranslate();
	return (
		<div className="space-y-2 border-t pt-5">
			<h4 className="flex items-center gap-2 text-sm font-medium">
				<IconInfoCircle className="size-4 shrink-0" aria-hidden="true" />
				{t(
					"settings.enterprise.sso.guide.afterSaveTitle",
					"After saving your provider",
				)}
			</h4>
			<p className="text-sm leading-relaxed text-muted-foreground">
				{t(
					"settings.enterprise.sso.guide.afterSave",
					"After saving, verify your email domain with the DNS TXT record in Z8. Pilot sign-in with an intended user while keeping your current administrator session open. In Guided setup, save the same provider ID and email domain shown in the provider list, then manually record the observed sign-in result before considering Require SSO. Saving and DNS verification do not prove a successful sign-in.",
				)}
			</p>
			<Link
				href="/settings/enterprise/identity-setup?tab=setup"
				className="inline-flex text-sm text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
			>
				{t("settings.enterprise.sso.guide.openSetup", "Open Guided setup")}
			</Link>
		</div>
	);
}

function EntraTroubleshooting() {
	const { t } = useTranslate();
	return (
		<details className="border-t pt-5">
			<summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">
				{t(
					"settings.enterprise.sso.guide.entra.troubleshooting",
					"Troubleshoot Entra setup",
				)}
			</summary>
			<div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
				<p>
					{t(
						"settings.enterprise.sso.guide.entra.redirectError",
						"AADSTS50011: Check that the Web redirect URI matches the callback shown by Z8 exactly, including its hostname and path.",
					)}
				</p>
				<p>
					{t(
						"settings.enterprise.sso.guide.entra.secretError",
						"Invalid client secret: Use the secret's Value, not its ID. Check that it belongs to this application and has not expired. Create a new secret if you no longer have the Value.",
					)}
				</p>
				<p>
					{t(
						"settings.enterprise.sso.guide.entra.tenantError",
						"Wrong tenant: Copy Directory (tenant) ID from the same app registration as the client ID. This guided setup uses a specific tenant, not common or organizations.",
					)}
				</p>
				<p>
					{t(
						"settings.enterprise.sso.guide.entra.consentError",
						"Consent or access denied: Ask your Entra administrator to check consent policies and whether the pilot user is assigned to the application.",
					)}
				</p>
				<a
					className="text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
					href="https://learn.microsoft.com/en-us/troubleshoot/entra/entra-id/app-integration/error-code-aadsts50011-redirect-uri-mismatch"
					target="_blank"
					rel="noopener noreferrer"
				>
					{t(
						"settings.enterprise.sso.guide.entra.troubleshootingLink",
						"Microsoft's redirect troubleshooting guide",
					)}
				</a>
			</div>
		</details>
	);
}
