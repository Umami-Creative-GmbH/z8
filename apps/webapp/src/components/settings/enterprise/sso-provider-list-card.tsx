import {
	IconCheck,
	IconCopy,
	IconExternalLink,
	IconInfoCircle,
	IconKey,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSsoDomainTxtRecord } from "@/lib/enterprise-identity/sso-domain-verification";
import { cn } from "@/lib/utils";

export interface SsoProvider {
	id: string;
	issuer: string;
	domain: string;
	providerId: string;
	domainVerified: boolean | null;
	domainVerificationToken: string | null;
	createdAt: Date | null;
}

interface SsoProviderListCardProps {
	busyProviderId: string | null;
	providers: SsoProvider[];
	tokenByProviderId: Record<string, string>;
	onDelete: (provider: SsoProvider) => void;
	onRequestVerificationToken: (provider: SsoProvider) => void;
	onVerifyDomain: (provider: SsoProvider) => void;
}

function getProviderDisplayName(issuer: string) {
	if (issuer.includes("okta")) return "Okta";
	if (issuer.includes("azure") || issuer.includes("microsoft")) return "Microsoft Entra ID";
	if (issuer.includes("google")) return "Google Workspace";
	if (issuer.includes("auth0")) return "Auth0";
	if (issuer.includes("onelogin")) return "OneLogin";
	if (issuer.includes("ping")) return "PingIdentity";
	return "OIDC Provider";
}

function CopyButton({ value, label }: { value: string; label: string }) {
	const { t } = useTranslate();
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (resetTimer.current) clearTimeout(resetTimer.current);
		},
		[],
	);

	const copy = async () => {
		const ok = await navigator.clipboard
			.writeText(value)
			.then(() => true)
			.catch(() => false);
		if (!ok) {
			toast.error(t("settings.enterprise.sso.copyError", "Could not copy to clipboard"));
			return;
		}
		setCopied(true);
		toast.success(t("settings.enterprise.domains.copiedToClipboard", "Copied to clipboard"));
		if (resetTimer.current) clearTimeout(resetTimer.current);
		resetTimer.current = setTimeout(() => setCopied(false), 2000);
	};

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			className="size-7 shrink-0"
			aria-label={label}
			title={label}
			onClick={copy}
		>
			{copied ? (
				<IconCheck className="size-4 text-success" aria-hidden="true" />
			) : (
				<IconCopy className="size-4" aria-hidden="true" />
			)}
		</Button>
	);
}

/** One label/value line. Values never wrap; long ones scroll horizontally. */
function DetailRow({
	label,
	children,
	copyValue,
	copyLabel,
	mono = false,
}: {
	label: string;
	children: ReactNode;
	copyValue?: string;
	copyLabel?: string;
	mono?: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
			<dt className="shrink-0 text-xs font-medium text-muted-foreground sm:w-28">{label}</dt>
			<dd className="flex min-w-0 flex-1 items-center gap-1">
				<span
					className={cn(
						"min-w-0 flex-1 overflow-x-auto whitespace-nowrap",
						mono && "font-mono text-[13px]",
					)}
					translate={mono ? "no" : undefined}
				>
					{children}
				</span>
				{copyValue && copyLabel ? <CopyButton value={copyValue} label={copyLabel} /> : null}
			</dd>
		</div>
	);
}

function DnsRecordInstructions({ provider, token }: { provider: SsoProvider; token: string }) {
	const { t } = useTranslate();
	const record = getSsoDomainTxtRecord({
		providerId: provider.providerId,
		domain: provider.domain,
		token,
	});

	return (
		<div className="space-y-3 rounded-lg border bg-muted/40 p-4">
			<div className="space-y-1">
				<p className="text-sm font-medium">
					{t("settings.enterprise.sso.dns.title", "Add this TXT record to your DNS")}
				</p>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{t(
						"settings.enterprise.sso.dns.description",
						"Create the record at your DNS provider for {domain}, then select Verify. DNS changes can take a few minutes to propagate.",
						{ domain: provider.domain },
					)}
				</p>
			</div>
			<dl className="space-y-2 rounded-md border bg-background p-3">
				<DetailRow label={t("settings.enterprise.sso.dns.type", "Type")} mono>
					TXT
				</DetailRow>
				<DetailRow
					label={t("settings.enterprise.domains.nameHost", "Name / Host")}
					copyValue={record.host}
					copyLabel={t("settings.enterprise.sso.dns.copyHost", "Copy record name")}
					mono
				>
					{record.host}
				</DetailRow>
				<DetailRow
					label={t("settings.enterprise.domains.value", "Value")}
					copyValue={record.value}
					copyLabel={t("settings.enterprise.sso.dns.copyValue", "Copy TXT token")}
					mono
				>
					{record.value}
				</DetailRow>
			</dl>
			<div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
				<IconInfoCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
				<div className="min-w-0 flex-1 space-y-1">
					<p>
						{t(
							"settings.enterprise.sso.dns.fqdnHint",
							"If your DNS provider expects the fully qualified name, use:",
						)}
					</p>
					<div className="flex min-w-0 items-center gap-1">
						<code
							className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono"
							translate="no"
						>
							{record.fqdn}
						</code>
						<CopyButton
							value={record.fqdn}
							label={t("settings.enterprise.sso.dns.copyFqdn", "Copy fully qualified name")}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

function SsoProviderItem({
	provider,
	token,
	busy,
	onDelete,
	onRequestVerificationToken,
	onVerifyDomain,
}: {
	provider: SsoProvider;
	token: string | null;
	busy: boolean;
	onDelete: () => void;
	onRequestVerificationToken: () => void;
	onVerifyDomain: () => void;
}) {
	const { t } = useTranslate();
	const verified = Boolean(provider.domainVerified);

	return (
		<li className="space-y-4 p-4">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-center gap-2">
					<h3 className="whitespace-nowrap font-medium">
						{getProviderDisplayName(provider.issuer)}
					</h3>
					{verified ? (
						<Badge variant="success">
							<IconCheck className="size-3" aria-hidden="true" />
							{t("settings.enterprise.sso.guide.domainVerified", "Domain verified")}
						</Badge>
					) : (
						<Badge variant="secondary">
							<IconX className="size-3" aria-hidden="true" />
							{t("settings.enterprise.sso.guide.domainPending", "Domain not verified")}
						</Badge>
					)}
				</div>
				<div className="flex flex-wrap justify-end gap-2">
					{!verified ? (
						<>
							<Button
								variant="outline"
								size="sm"
								disabled={busy}
								onClick={onRequestVerificationToken}
							>
								<IconKey className="size-4" aria-hidden="true" />
								{token
									? t("settings.enterprise.sso.regenerateToken", "Regenerate TXT token")
									: t("settings.enterprise.sso.generateToken", "Generate TXT token")}
							</Button>
							<Button variant="outline" size="sm" disabled={busy} onClick={onVerifyDomain}>
								<IconRefresh className="size-4" aria-hidden="true" />
								{t("settings.enterprise.sso.verify", "Verify")}
							</Button>
						</>
					) : null}
					<Button
						aria-label={t(
							"settings.enterprise.sso.deleteProviderAria",
							"Delete SSO provider {provider}",
							{ provider: provider.providerId },
						)}
						variant="outline"
						size="sm"
						onClick={onDelete}
					>
						<IconTrash className="size-4 text-destructive" aria-hidden="true" />
					</Button>
				</div>
			</div>

			<dl className="space-y-2 text-sm">
				<DetailRow label={t("settings.enterprise.domain", "Domain")}>{provider.domain}</DetailRow>
				<DetailRow
					label={t("settings.enterprise.sso.providerId", "Provider ID")}
					copyValue={provider.providerId}
					copyLabel={t("settings.enterprise.sso.copyProviderId", "Copy provider ID")}
					mono
				>
					{provider.providerId}
				</DetailRow>
				<DetailRow
					label={t("settings.enterprise.sso.issuerUrl", "Issuer URL")}
					copyValue={provider.issuer}
					copyLabel={t("settings.enterprise.sso.copyIssuerUrl", "Copy issuer URL")}
				>
					<a
						href={provider.issuer}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						{provider.issuer}
						<IconExternalLink className="size-3 shrink-0" aria-hidden="true" />
					</a>
				</DetailRow>
			</dl>

			{!verified ? (
				token ? (
					<DnsRecordInstructions provider={provider} token={token} />
				) : (
					<p className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
						<IconInfoCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
						{t(
							"settings.enterprise.sso.dns.noToken",
							"Generate a TXT token to see the DNS record that proves you own this domain.",
						)}
					</p>
				)
			) : null}
		</li>
	);
}

export function SsoProviderListCard({
	busyProviderId,
	providers,
	tokenByProviderId,
	onDelete,
	onRequestVerificationToken,
	onVerifyDomain,
}: SsoProviderListCardProps) {
	return (
		<ul className="divide-y rounded-lg border">
			{providers.map((provider) => (
				<SsoProviderItem
					key={provider.id}
					provider={provider}
					token={tokenByProviderId[provider.providerId] ?? provider.domainVerificationToken}
					busy={busyProviderId === provider.id}
					onDelete={() => onDelete(provider)}
					onRequestVerificationToken={() => onRequestVerificationToken(provider)}
					onVerifyDomain={() => onVerifyDomain(provider)}
				/>
			))}
		</ul>
	);
}
