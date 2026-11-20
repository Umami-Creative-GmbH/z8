"use client";

import { IconExternalLink, IconSettings } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteDomainAction,
	type PlatformAuthConfigResponse,
	regenerateVerificationTokenAction,
	storeTurnstileSecretAction,
	updateDomainAuthConfigAction,
	updatePlatformAuthConfigAction,
	verifyDomainAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import { actionData, enterpriseErrorMessage } from "@/components/settings/enterprise/action-data";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useServerDataState } from "@/hooks/use-server-data-state";
import type { AuthConfig } from "@/lib/domain";
import { type CustomDomain, CustomDomainSummary } from "./custom-domain-summary";
import { DomainAddDialog } from "./domain-add-dialog";
import { DomainAuthConfigDialog } from "./domain-auth-config-dialog";
import { DomainVerificationDialog } from "./domain-verification-dialog";
import {
	EnterpriseDeleteConfirmDialog,
	useConfirmedRemoval,
} from "./enterprise-delete-confirm-dialog";

type Domain = CustomDomain;

interface DomainManagementProps {
	initialDomains: Domain[];
	organizationId: string;
	defaultUrls: {
		canonical: string;
	};
	initialPlatformAuth: PlatformAuthConfigResponse;
}

const PLATFORM_DOMAIN_ID = "canonical";

export function DomainManagement({
	initialDomains,
	organizationId,
	defaultUrls,
	initialPlatformAuth,
}: DomainManagementProps) {
	const { t } = useTranslate();
	const [platformAuthConfig, setPlatformAuthConfig] = useServerDataState<AuthConfig>(
		initialPlatformAuth.config,
	);
	const [isPlatformAuthDialogOpen, setIsPlatformAuthDialogOpen] = useState(false);
	const canonicalHost = new URL(defaultUrls.canonical).host;
	const handleUpdatePlatformAuthConfig = async (_domainId: string, config: AuthConfig) => {
		// The canonical domain stores sign-in methods only.
		const methods = {
			emailPasswordEnabled: config.emailPasswordEnabled,
			socialProvidersEnabled: config.socialProvidersEnabled,
			ssoEnabled: config.ssoEnabled,
			ssoProviderId: config.ssoProviderId,
			passkeyEnabled: config.passkeyEnabled,
			registrationEnabled: config.registrationEnabled,
		};
		const saved = await actionData(updatePlatformAuthConfigAction({ config: methods })).catch(
			(error: unknown) => {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.domains.authConfigUpdateFailed",
						"Failed to update auth configuration",
					]),
				);
				return null;
			},
		);
		if (!saved) return;
		setPlatformAuthConfig(saved);
		toast.success(t("settings.enterprise.domains.authConfigUpdated", "Auth configuration updated"));
		setIsPlatformAuthDialogOpen(false);
	};
	// Since each org can only have 1 domain, we track it as a single domain
	const [domain, setDomain] = useServerDataState<Domain | null>(initialDomains[0] ?? null);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [verificationDialog, setVerificationDialog] = useState<{
		isOpen: boolean;
		domain: Domain | null;
	}>({ isOpen: false, domain: null });
	const [authConfigDialog, setAuthConfigDialog] = useState<{
		isOpen: boolean;
		domain: Domain | null;
	}>({ isOpen: false, domain: null });
	const removal = useConfirmedRemoval<Domain>();
	const [isVerifying, setIsVerifying] = useState(false);

	const handleDomainAdded = (newDomain: Domain) => {
		setDomain(newDomain);
		setIsAddDialogOpen(false);
		// Open verification dialog for the new domain
		setVerificationDialog({ isOpen: true, domain: newDomain });
	};

	const handleVerify = async (domainId: string) => {
		setIsVerifying(true);
		const verified = await actionData(verifyDomainAction({ domainId })).catch(() => null);
		if (verified) {
			setDomain((prev) =>
				prev ? { ...prev, domainVerified: true, verificationToken: null } : null,
			);
			toast.success(
				t("settings.enterprise.domains.verifiedSuccess", "Domain verified successfully"),
			);
			setVerificationDialog({ isOpen: false, domain: null });
		} else {
			toast.error(t("settings.enterprise.domains.verifyFailed", "Failed to verify domain"));
		}
		setIsVerifying(false);
	};

	const handleRegenerateToken = async (domainId: string) => {
		const newToken = await actionData(regenerateVerificationTokenAction({ domainId })).catch(
			() => null,
		);
		if (!newToken) {
			toast.error(
				t("settings.enterprise.domains.regenerateTokenFailed", "Failed to regenerate token"),
			);
			return;
		}

		setDomain((prev) =>
			prev
				? {
						...prev,
						verificationToken: newToken,
						verificationTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
					}
				: null,
		);
		toast.success(
			t("settings.enterprise.domains.regenerateTokenSuccess", "New verification token generated"),
		);
	};

	const handleUpdateAuthConfig = async (
		domainId: string,
		config: AuthConfig,
		turnstileSecretKey?: string,
	) => {
		// Store Turnstile secret in Vault if provided
		if (turnstileSecretKey && config.turnstileSiteKey) {
			const secretStored = await actionData(
				storeTurnstileSecretAction({ secretKey: turnstileSecretKey }),
			)
				.then(() => true)
				.catch(() => false);
			if (!secretStored) {
				toast.error(
					t(
						"settings.enterprise.domains.authConfigUpdateFailed",
						"Failed to update auth configuration",
					),
				);
				return;
			}
		}

		const authUpdated = await actionData(updateDomainAuthConfigAction({ domainId, config }))
			.then(() => true)
			.catch((error: unknown) => {
				toast.error(
					enterpriseErrorMessage(t, error, [
						"settings.enterprise.domains.authConfigUpdateFailed",
						"Failed to update auth configuration",
					]),
				);
				return false;
			});
		if (!authUpdated) return;

		setDomain((prev) => (prev ? { ...prev, authConfig: config } : null));
		toast.success(t("settings.enterprise.domains.authConfigUpdated", "Auth configuration updated"));
		setAuthConfigDialog({ isOpen: false, domain: null });
	};

	const handleDelete = () =>
		removal.confirm(
			async (selectedDomain) => {
				await actionData(deleteDomainAction({ domainId: selectedDomain.id }));
				setDomain(null);
				toast.success(t("settings.enterprise.domains.deleted", "Domain deleted"));
			},
			(error) =>
				enterpriseErrorMessage(t, error, [
					"settings.enterprise.domains.deleteFailed",
					"Failed to delete domain",
				]),
		);

	return (
		<>
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.enterprise.domains.defaultUrls", "Default URLs")}</CardTitle>
					<CardDescription>
						{t(
							"settings.enterprise.domains.defaultUrlsDescription",
							"These platform-managed URLs work automatically without custom DNS setup.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{[
						{
							label: t("settings.enterprise.domains.defaultUrl.canonical", "Canonical"),
							url: defaultUrls.canonical,
						},
					].map(({ label, url }) => (
						<div
							key={url}
							className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
						>
							<div className="min-w-0">
								<p className="text-sm font-medium">{label}</p>
								<p className="truncate font-mono text-muted-foreground text-sm">{url}</p>
							</div>
							<div className="flex flex-wrap gap-2">
								<Button
									variant="outline"
									size="sm"
									className="w-fit"
									onClick={() => setIsPlatformAuthDialogOpen(true)}
								>
									<IconSettings className="mr-2 size-4" aria-hidden="true" />
									{t("settings.enterprise.domains.signInMethods", "Sign-in methods")}
								</Button>
								<Button asChild variant="outline" size="sm" className="w-fit">
									<a href={url} target="_blank" rel="noreferrer">
										<IconExternalLink className="mr-2 size-4" aria-hidden="true" />
										{t("common.open", "Open")}
									</a>
								</Button>
							</div>
						</div>
					))}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.enterprise.domains.customDomain", "Custom Domain")}</CardTitle>
					<CardDescription>
						{t(
							"settings.enterprise.domains.customDomainDescription",
							"Configure a custom domain to enable an organization-specific login page with your branding.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<CustomDomainSummary
						domain={domain}
						onAdd={() => setIsAddDialogOpen(true)}
						onConfigure={(selectedDomain) =>
							setAuthConfigDialog({ isOpen: true, domain: selectedDomain })
						}
						onDelete={removal.request}
						onVerify={(selectedDomain) =>
							setVerificationDialog({ isOpen: true, domain: selectedDomain })
						}
					/>
				</CardContent>
			</Card>

			<DomainAddDialog
				open={isAddDialogOpen}
				onOpenChange={setIsAddDialogOpen}
				onDomainAdded={handleDomainAdded}
			/>

			<DomainVerificationDialog
				open={verificationDialog.isOpen}
				onOpenChange={(open) =>
					setVerificationDialog({ isOpen: open, domain: verificationDialog.domain })
				}
				domain={verificationDialog.domain}
				onVerify={handleVerify}
				onRegenerateToken={handleRegenerateToken}
				isVerifying={isVerifying}
			/>

			<DomainAuthConfigDialog
				open={authConfigDialog.isOpen}
				onOpenChange={(open) =>
					setAuthConfigDialog({ isOpen: open, domain: authConfigDialog.domain })
				}
				domain={authConfigDialog.domain}
				organizationId={organizationId}
				ssoProviderAvailable={initialPlatformAuth.ssoProviderAvailable}
				onSave={handleUpdateAuthConfig}
			/>

			<DomainAuthConfigDialog
				open={isPlatformAuthDialogOpen}
				onOpenChange={setIsPlatformAuthDialogOpen}
				domain={{ id: PLATFORM_DOMAIN_ID, domain: canonicalHost, authConfig: platformAuthConfig }}
				organizationId={organizationId}
				variant="platform"
				ssoProviderAvailable={initialPlatformAuth.ssoProviderAvailable}
				onSave={handleUpdatePlatformAuthConfig}
			/>

			<EnterpriseDeleteConfirmDialog
				open={removal.open}
				onOpenChange={removal.onOpenChange}
				title={t("settings.enterprise.domains.deleteTitle", "Delete Domain")}
				description={t(
					"settings.enterprise.domains.deleteDescription",
					'Are you sure you want to delete "{domain}"? This action cannot be undone. Users will no longer be able to sign in via this custom domain.',
					{ domain: removal.target?.domain ?? "" },
				)}
				confirmLabel={t("settings.enterprise.domains.deleteConfirm", "Delete domain")}
				isPending={removal.isPending}
				error={removal.error}
				onConfirm={handleDelete}
			/>
		</>
	);
}
