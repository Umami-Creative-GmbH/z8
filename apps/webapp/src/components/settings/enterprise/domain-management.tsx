"use client";

import {
	IconCheck,
	IconPlus,
	IconRefresh,
	IconSettings,
	IconTrash,
	IconWorld,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteDomainAction,
	regenerateVerificationTokenAction,
	storeTurnstileSecretAction,
	updateDomainAuthConfigAction,
	verifyDomainAction,
} from "@/app/[locale]/(app)/settings/enterprise/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthConfig } from "@/lib/domain";
import { DomainAddDialog } from "./domain-add-dialog";
import { DomainAuthConfigDialog } from "./domain-auth-config-dialog";
import { DomainVerificationDialog } from "./domain-verification-dialog";

interface Domain {
	id: string;
	domain: string;
	domainVerified: boolean;
	isPrimary: boolean;
	verificationToken: string | null;
	verificationTokenExpiresAt: Date | null;
	authConfig: AuthConfig;
	createdAt: Date;
}

interface DomainManagementProps {
	initialDomains: Domain[];
	organizationId: string;
}

export function DomainManagement({ initialDomains, organizationId }: DomainManagementProps) {
	const { t } = useTranslate();
	// Since each org can only have 1 domain, we track it as a single domain
	const [domain, setDomain] = useState<Domain | null>(initialDomains[0] ?? null);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [verificationDialog, setVerificationDialog] = useState<{
		isOpen: boolean;
		domain: Domain | null;
	}>({ isOpen: false, domain: null });
	const [authConfigDialog, setAuthConfigDialog] = useState<{
		isOpen: boolean;
		domain: Domain | null;
	}>({ isOpen: false, domain: null });
	const [deleteDialog, setDeleteDialog] = useState<{
		isOpen: boolean;
		domain: Domain | null;
	}>({ isOpen: false, domain: null });
	const [isVerifying, setIsVerifying] = useState(false);
	const hasTurnstileSiteKey = Boolean(domain?.authConfig.turnstileSiteKey?.trim());
	const hasCookieConsentScript = Boolean(domain?.authConfig.cookieConsentScript?.trim());

	const handleDomainAdded = (newDomain: Domain) => {
		setDomain(newDomain);
		setIsAddDialogOpen(false);
		// Open verification dialog for the new domain
		setVerificationDialog({ isOpen: true, domain: newDomain });
	};

	const handleVerify = async (domainId: string) => {
		setIsVerifying(true);
		const verified = await verifyDomainAction(domainId).catch(() => null);
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
		const newToken = await regenerateVerificationTokenAction(domainId).catch(() => null);
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
			const secretStored = await storeTurnstileSecretAction(turnstileSecretKey)
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

		const authUpdated = await updateDomainAuthConfigAction(domainId, config)
			.then(() => true)
			.catch(() => false);
		if (!authUpdated) {
			toast.error(
				t(
					"settings.enterprise.domains.authConfigUpdateFailed",
					"Failed to update auth configuration",
				),
			);
			return;
		}

		setDomain((prev) => (prev ? { ...prev, authConfig: config } : null));
		toast.success(t("settings.enterprise.domains.authConfigUpdated", "Auth configuration updated"));
		setAuthConfigDialog({ isOpen: false, domain: null });
	};

	const handleDelete = async () => {
		if (!deleteDialog.domain) return;

		const deleted = await deleteDomainAction(deleteDialog.domain.id)
			.then(() => true)
			.catch(() => false);
		if (deleted) {
			setDomain(null);
			toast.success(t("settings.enterprise.domains.deleted", "Domain deleted"));
		} else {
			toast.error(t("settings.enterprise.domains.deleteFailed", `Failed to delete domain`));
		}
		setDeleteDialog({ isOpen: false, domain: null });
	};

	return (
		<>
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
					{!domain ? (
						<div className="text-center py-8">
							<div className="mx-auto size-12 rounded-full bg-muted flex items-center justify-center mb-4">
								<IconWorld className="size-6 text-muted-foreground" />
							</div>
							<p className="text-muted-foreground mb-4">
								{t("settings.enterprise.domains.empty", "No custom domain configured yet.")}
							</p>
							<Button onClick={() => setIsAddDialogOpen(true)}>
								<IconPlus className="mr-2 size-4" />
								{t("settings.enterprise.domains.add", "Add Custom Domain")}
							</Button>
						</div>
					) : (
						<div className="space-y-4">
							{/* Domain Info */}
							<div className="flex items-center justify-between p-4 border rounded-lg">
								<div className="flex items-center gap-4">
									<div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
										<IconWorld className="size-5 text-primary" />
									</div>
									<div>
										<p className="font-medium">{domain.domain}</p>
										<div className="flex items-center gap-2 mt-1">
											{domain.domainVerified ? (
												<Badge variant="default" className="bg-green-600">
													<IconCheck className="mr-1 size-3" />
													{t("settings.enterprise.domains.status.verified", "Verified")}
												</Badge>
											) : (
												<Badge variant="destructive">
													<IconX className="mr-1 size-3" />
													{t("settings.enterprise.domains.status.pending", "Pending Verification")}
												</Badge>
											)}
										</div>
									</div>
								</div>
								<div className="flex gap-2">
									{!domain.domainVerified && (
										<Button
											variant="outline"
											size="sm"
											onClick={() => setVerificationDialog({ isOpen: true, domain })}
										>
											<IconRefresh className="mr-1 size-4" />
											{t("settings.enterprise.domains.verify", "Verify")}
										</Button>
									)}
									<Button
										aria-label={t(
											"settings.enterprise.domains.editAuthSettingsAria",
											"Edit authentication settings for {domain}",
											{ domain: domain.domain },
										)}
										variant="outline"
										size="sm"
										onClick={() => setAuthConfigDialog({ isOpen: true, domain })}
									>
										<IconSettings className="size-4" aria-hidden="true" />
									</Button>
									<Button
										aria-label={t(
											"settings.enterprise.domains.deleteAria",
											"Delete custom domain {domain}",
											{ domain: domain.domain },
										)}
										variant="outline"
										size="sm"
										onClick={() => setDeleteDialog({ isOpen: true, domain })}
									>
										<IconTrash className="size-4 text-destructive" aria-hidden="true" />
									</Button>
								</div>
							</div>

							{/* Auth Methods Summary */}
							<div className="p-4 bg-muted/50 rounded-lg">
								<p className="text-sm font-medium mb-2">
									{t("settings.enterprise.domains.enabledAuthMethods", "Enabled Auth Methods")}
								</p>
								<div className="flex flex-wrap gap-2">
									{domain.authConfig.emailPasswordEnabled && (
										<Badge variant="outline">
											{t("settings.enterprise.domains.authMethod.emailPassword", "Email/Password")}
										</Badge>
									)}
									{domain.authConfig.ssoEnabled && (
										<Badge variant="outline">
											{t("settings.enterprise.domains.authMethod.sso", "SSO")}
										</Badge>
									)}
									{domain.authConfig.socialProvidersEnabled.length > 0 && (
										<Badge variant="outline">
											{t("settings.enterprise.domains.authMethod.social", "Social ({providers})", {
												providers: domain.authConfig.socialProvidersEnabled.join(", "),
											})}
										</Badge>
									)}
									{domain.authConfig.passkeyEnabled && (
										<Badge variant="outline">
											{t("settings.enterprise.domains.authMethod.passkey", "Passkey")}
										</Badge>
									)}
								</div>
							</div>

							<div className="p-4 bg-muted/50 rounded-lg">
								<p className="text-sm font-medium mb-2">
									{t("settings.enterprise.domains.domainPageSettings", "Domain Page Settings")}
								</p>
								<div className="flex flex-wrap gap-2">
									<Badge variant={hasTurnstileSiteKey ? "outline" : "secondary"}>
										{t(
											"settings.enterprise.domains.turnstileSiteKeyStatus",
											"Turnstile site key {status}",
											{
												status: hasTurnstileSiteKey
													? t("settings.enterprise.domains.configured", "configured")
													: t("settings.enterprise.domains.notConfigured", "not configured"),
											},
										)}
									</Badge>
									<Badge variant={hasCookieConsentScript ? "outline" : "secondary"}>
										{t(
											"settings.enterprise.domains.cookieConsentStatus",
											"Cookie consent {status}",
											{
												status: hasCookieConsentScript
													? t("settings.enterprise.domains.configured", "configured")
													: t("settings.enterprise.domains.notConfigured", "not configured"),
											},
										)}
									</Badge>
								</div>
							</div>
						</div>
					)}
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
				onSave={handleUpdateAuthConfig}
			/>

			<AlertDialog
				open={deleteDialog.isOpen}
				onOpenChange={(open) => setDeleteDialog({ isOpen: open, domain: deleteDialog.domain })}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.enterprise.domains.deleteTitle", "Delete Domain")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.enterprise.domains.deleteDescription",
								'Are you sure you want to delete "{domain}"? This action cannot be undone. Users will no longer be able to sign in via this custom domain.',
								{ domain: deleteDialog.domain?.domain ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
