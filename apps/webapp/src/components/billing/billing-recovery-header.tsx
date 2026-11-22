"use client";

import {
	IconArrowLeft,
	IconBuilding,
	IconCheck,
	IconChevronDown,
	IconCreditCard,
	IconLoader2,
	IconLogout,
	IconPlus,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CreateOrganizationDialog } from "@/components/organization/create-organization-dialog";
import { OrganizationLogo } from "@/components/organization/organization-logo";
import { clearManualRecoveries } from "@/components/time-tracking/manual-command-recovery";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserOrganization } from "@/lib/auth-helpers";
import { normalizeAppPath } from "@/lib/navigation/route-metadata";
import { saveLastOrganization } from "@/lib/org-persistence";
import { signOut } from "@/lib/store-app/sign-out";
import { Link, usePathname, useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

interface BillingRecoveryHeaderProps {
	organizations: UserOrganization[];
	currentOrganization: UserOrganization | null;
	canCreateOrganizations?: boolean;
	canAccessBilling: boolean;
}

export function BillingRecoveryHeader({
	organizations,
	currentOrganization,
	canCreateOrganizations = false,
	canAccessBilling,
}: BillingRecoveryHeaderProps) {
	const { t } = useTranslate();
	const pathname = usePathname();
	const { push, refresh } = useRouter();
	const resetOrgSettings = useOrganizationSettings((state) => state.reset);
	const [switching, setSwitching] = useState(false);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [isLoggingOut, setIsLoggingOut] = useState(false);

	const normalizedPath = normalizeAppPath(pathname);
	const isOnBillingSettings =
		normalizedPath === "/settings/billing" || normalizedPath.startsWith("/settings/billing/");
	const activeOrg = currentOrganization || organizations[0] || null;

	const handleSwitchOrganization = async (organizationId: string) => {
		if (organizationId === currentOrganization?.id) return;

		setSwitching(true);
		resetOrgSettings();

		const response = await fetch("/api/organizations/switch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ organizationId }),
		}).catch(() => null);

		if (!response) {
			toast.error(t("organization.switchFailed", "Failed to switch organization"));
			setSwitching(false);
			return;
		}

		if (!response.ok) {
			const error = await response.json().catch(() => null);
			if (error?.code === "SSO_REQUIRED" || error?.code === "MFA_REQUIRED") {
				window.location.assign(`/init?organizationId=${encodeURIComponent(organizationId)}`);
				return;
			}
			toast.error(error?.error || t("organization.switchFailed", "Failed to switch organization"));
			setSwitching(false);
			return;
		}

		const result = await response.json().catch(() => null);
		if (!result) {
			toast.error(t("organization.switchFailed", "Failed to switch organization"));
			setSwitching(false);
			return;
		}

		saveLastOrganization(organizationId);

		if (!result.hasEmployeeRecord) {
			toast.warning(
				t(
					"organization.noEmployeeRecord",
					"You are not set up as an employee in this organization yet.",
				),
			);
		}

		// Leaving the suspension notice lets an active destination organization land in the workspace.
		if (!isOnBillingSettings) {
			window.location.assign("/");
			return;
		}

		window.location.reload();
	};

	const handleSignOut = async () => {
		if (isLoggingOut) return;
		setIsLoggingOut(true);
		const showLogoutError = () => {
			toast.error(t("user.log-out-failed", "Could not log out. Please try again."), {
				id: "logout-failed",
			});
		};
		try {
			await signOut({
				fetchOptions: {
					onSuccess: () => {
						clearManualRecoveries();
						setTimeout(() => {
							push("/sign-in");
						}, 100);
					},
					onError: () => {
						setIsLoggingOut(false);
						showLogoutError();
					},
				},
			});
		} catch {
			setIsLoggingOut(false);
			showLogoutError();
		}
	};

	return (
		<>
			<header className="box-content flex h-16 shrink-0 items-center border-b bg-card pt-[env(safe-area-inset-top)]">
				<div className="mx-auto flex w-full max-w-[120rem] min-w-0 items-center justify-between gap-2 px-4 lg:px-6">
					<div className="min-w-0">
						{activeOrg ? (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="outline"
										className="h-10 max-w-64 gap-2 px-2.5"
										aria-label={`${t("organization.switchTo", "Switch Organization")}: ${activeOrg.name}`}
										disabled={switching}
									>
										<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
											<OrganizationLogo
												logo={activeOrg.logo}
												name={activeOrg.name}
												size="xs"
												fallbackClassName="bg-transparent text-primary"
											/>
										</span>
										<span className="truncate text-sm font-medium">{activeOrg.name}</span>
										{switching ? (
											<IconLoader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
										) : (
											<IconChevronDown
												className="size-4 shrink-0 text-muted-foreground"
												aria-hidden="true"
											/>
										)}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent className="min-w-56 rounded-lg" align="start" sideOffset={4}>
									<DropdownMenuLabel className="text-xs text-muted-foreground">
										{t("organization.switchTo", "Switch Organization")}
									</DropdownMenuLabel>
									{organizations.map((org) => (
										<DropdownMenuItem
											key={org.id}
											onClick={() => void handleSwitchOrganization(org.id)}
											className="gap-2 p-2"
											disabled={switching}
										>
											<div className="flex size-6 items-center justify-center rounded-sm border">
												<OrganizationLogo
													logo={org.logo}
													name={org.name}
													size="xs"
													className="rounded-sm"
													fallbackClassName="rounded-sm bg-transparent"
												/>
											</div>
											<div className="flex-1">
												<div className="font-medium">{org.name}</div>
												<div className="text-xs text-muted-foreground">{org.memberRole}</div>
											</div>
											{org.id === activeOrg.id ? (
												<IconCheck className="size-4" aria-hidden="true" />
											) : null}
										</DropdownMenuItem>
									))}
									{canCreateOrganizations ? (
										<>
											<DropdownMenuSeparator />
											<DropdownMenuItem
												className="gap-2 p-2"
												onClick={() => setCreateDialogOpen(true)}
											>
												<div className="flex size-6 items-center justify-center rounded-md border border-dashed">
													<IconPlus className="size-4" aria-hidden="true" />
												</div>
												<div className="font-medium text-muted-foreground">
													{t("organization.create", "Create Organization")}
												</div>
											</DropdownMenuItem>
										</>
									) : null}
								</DropdownMenuContent>
							</DropdownMenu>
						) : (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<IconBuilding className="size-4 shrink-0" aria-hidden="true" />
								<span className="truncate font-medium">
									{t("organization.noOrganizations", "No Organizations")}
								</span>
							</div>
						)}
					</div>

					<div className="flex shrink-0 items-center gap-2">
						{canAccessBilling ? (
							<nav
								aria-label={t("billing.recovery.navigationLabel", "Billing recovery navigation")}
							>
								{isOnBillingSettings ? (
									<Button asChild variant="outline" size="sm">
										<Link href="/billing/suspended">
											<IconArrowLeft className="size-4" aria-hidden="true" />
											{t("billing.recovery.suspensionNotice", "Suspension notice")}
										</Link>
									</Button>
								) : (
									<Button asChild variant="outline" size="sm">
										<Link href="/settings/billing">
											<IconCreditCard className="size-4" aria-hidden="true" />
											{t("billing.recovery.billingAndSubscription", "Billing & Subscription")}
										</Link>
									</Button>
								)}
							</nav>
						) : null}

						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => void handleSignOut()}
							disabled={isLoggingOut}
						>
							{isLoggingOut ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconLogout className="size-4" aria-hidden="true" />
							)}
							{t("user.log-out", "Log out")}
						</Button>
					</div>
				</div>
			</header>

			{canCreateOrganizations ? (
				<CreateOrganizationDialog
					open={createDialogOpen}
					onOpenChange={setCreateDialogOpen}
					onSuccess={() => refresh()}
				/>
			) : null}

			{switching && typeof document !== "undefined"
				? createPortal(
						<div className="fixed inset-0 z-9999 flex items-center justify-center">
							<div className="absolute inset-0 bg-black/20 backdrop-blur-md" />
							<div className="relative flex flex-col items-center justify-center gap-4 rounded-lg border bg-card/95 px-12 py-8 shadow-2xl backdrop-blur-sm">
								<IconLoader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
								<span className="font-medium text-sm">
									{t("organization.switching", "Switching organization...")}
								</span>
							</div>
						</div>,
						document.body,
					)
				: null}

			{isLoggingOut && typeof document !== "undefined"
				? createPortal(
						<div className="fixed inset-0 z-9999 flex items-center justify-center">
							<div className="absolute inset-0 bg-black/20 backdrop-blur-md" />
							<div className="relative flex flex-col items-center justify-center gap-4 rounded-lg border bg-card/95 px-12 py-8 shadow-2xl backdrop-blur-sm">
								<IconLoader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
								<span className="font-medium text-sm">
									{t("user.logging-out", "Logging out...")}
								</span>
							</div>
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
