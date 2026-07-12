"use client";

import {
	IconExternalLink,
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AuthConfig } from "@/lib/domain";
import { CustomDomainSummary, type CustomDomain } from "./custom-domain-summary";
import { DomainAddDialog } from "./domain-add-dialog";
import { DomainAuthConfigDialog } from "./domain-auth-config-dialog";
import { DomainVerificationDialog } from "./domain-verification-dialog";

type Domain = CustomDomain;

interface DomainManagementProps {
	initialDomains: Domain[];
	organizationId: string;
	defaultUrls: {
		canonical: string;
	};
}

export function DomainManagement({
	initialDomains,
	organizationId,
	defaultUrls,
}: DomainManagementProps) {
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
							<Button asChild variant="outline" size="sm" className="w-fit">
								<a href={url} target="_blank" rel="noreferrer">
									<IconExternalLink className="mr-2 size-4" aria-hidden="true" />
									{t("common.open", "Open")}
								</a>
							</Button>
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
						onDelete={(selectedDomain) =>
							setDeleteDialog({ isOpen: true, domain: selectedDomain })
						}
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
