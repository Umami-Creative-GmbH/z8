"use client";

import { IconBuilding, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLastOrganization, saveLastOrganization } from "@/lib/org-persistence";

type Organization = {
	id: string;
	name: string;
};

type Status = "checking" | "selecting" | "activating" | "redirecting";

/**
 * Transit page that ensures the user has an active organization before
 * redirecting to the dashboard. This page is outside the main app shell
 * so the organization context is fully established before loading the app.
 */
export default function InitPage() {
	const { t } = useTranslate();
	const hasInitialized = useRef(false);
	const [status, setStatus] = useState<Status>("checking");
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [selectedOrg, setSelectedOrg] = useState<string | null>(null);
	const [isActivating, setIsActivating] = useState(false);

	async function initializeSession() {
		// Check current session state
		const response = await fetch("/api/session/organization-status").catch((error) => {
			console.error("Failed to initialize session:", error);
			window.location.assign("/");
			return null;
		});
		if (!response) {
			return;
		}

		if (!response.ok) {
			// Check for app access denied error
			if (response.status === 403) {
				const errorData = await response.json().catch(() => null);
				if (errorData?.error === "AppAccessDenied") {
					// Redirect to access denied page
					window.location.assign(`/access-denied?app=${errorData.appType}`);
					return;
				}
			}
			// Not authenticated, redirect to login
			window.location.assign("/sign-in");
			return;
		}

		const data = await response.json().catch((error) => {
			console.error("Failed to parse organization status:", error);
			window.location.assign("/");
			return null;
		});
		if (!data) {
			return;
		}

		const { hasActiveOrganization, organizations: orgs } = data;

		// If already has an active org, go straight to dashboard
		if (hasActiveOrganization) {
			setStatus("redirecting");
			window.location.assign("/");
			return;
		}

		// No organizations at all, go to dashboard (will show appropriate state)
		if (!orgs || orgs.length === 0) {
			setStatus("redirecting");
			window.location.assign("/");
			return;
		}

		// Try to restore the last used organization
		const lastOrgId = getLastOrganization();

		if (lastOrgId) {
			// Check if it's still valid
			const isValid = orgs.some((org: Organization) => org.id === lastOrgId);
			if (isValid) {
				// Auto-activate the last used org
				await activateOrganization(lastOrgId);
				return;
			}
		}

		// Only one org available - auto-activate it
		if (orgs.length === 1) {
			await activateOrganization(orgs[0].id);
			return;
		}

		// Multiple orgs and no saved preference - show selection UI
		setOrganizations(orgs);
		setStatus("selecting");
	}

	async function activateOrganization(orgId: string) {
		setStatus("activating");
		setIsActivating(true);

		const switchResponse = await fetch("/api/organizations/switch", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ organizationId: orgId }),
		}).catch((error) => {
			console.error("Failed to activate organization:", error);
			setIsActivating(false);
			// On error, still try to go to dashboard
			window.location.assign("/");
			return null;
		});

		if (!switchResponse) {
			return;
		}

		if (switchResponse.ok) {
			saveLastOrganization(orgId);
		}

		// Hard redirect to dashboard to get fresh server state
		setStatus("redirecting");
		window.location.assign("/");
	}

	async function handleSelectOrganization(orgId: string) {
		setSelectedOrg(orgId);
		await activateOrganization(orgId);
	}

	useEffect(() => {
		if (hasInitialized.current) return;
		hasInitialized.current = true;

		const timer = setTimeout(() => {
			void initializeSession();
		}, 0);

		return () => clearTimeout(timer);
	}, []);

	// Show organization selection UI
	if (status === "selecting") {
		return (
			<div className="flex min-h-screen items-center justify-center bg-background p-4">
				<div className="w-full max-w-md space-y-6">
					<div className="text-center space-y-2">
						<h1 className="text-2xl font-semibold">
							{t("init.selectOrganization", "Select Organization")}
						</h1>
						<p className="text-muted-foreground">
							{t(
								"init.selectOrganizationDescription",
								"Choose which organization you want to work with",
							)}
						</p>
					</div>

					<div className="space-y-3">
						{organizations.map((org) => (
							<Card
								key={org.id}
								role="button"
								tabIndex={isActivating ? -1 : 0}
								className={`cursor-pointer transition-all hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
									selectedOrg === org.id ? "border-primary ring-2 ring-primary/20" : ""
								} ${isActivating ? "pointer-events-none opacity-50" : ""}`}
								onClick={() => handleSelectOrganization(org.id)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										handleSelectOrganization(org.id);
									}
								}}
							>
								<CardHeader className="p-4">
									<div className="flex items-center gap-3">
										<div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
											<IconBuilding className="size-5" aria-hidden="true" />
										</div>
										<div className="flex-1">
											<CardTitle className="text-base">{org.name}</CardTitle>
											<CardDescription className="text-xs">
												{t("init.clickToSelect", "Click to select")}
											</CardDescription>
										</div>
										{selectedOrg === org.id && (
											<IconCheck className="size-5 text-primary" aria-hidden="true" />
										)}
									</div>
								</CardHeader>
							</Card>
						))}
					</div>

					{isActivating && (
						<div
							className="flex items-center justify-center gap-2 text-sm text-muted-foreground"
							role="status"
							aria-live="polite"
						>
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							{t("init.activating", "Setting up your workspace...")}
						</div>
					)}
				</div>
			</div>
		);
	}

	// Show loading state
	return (
		<div className="flex min-h-screen items-center justify-center bg-background">
			<div className="flex flex-col items-center gap-4" role="status" aria-live="polite">
				<IconLoader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
				<p className="text-sm text-muted-foreground">
					{status === "checking" && t("init.checking", "Checking session...")}
					{status === "activating" && t("init.activating", "Setting up your workspace...")}
					{status === "redirecting" && t("init.redirecting", "Redirecting...")}
				</p>
			</div>
		</div>
	);
}
