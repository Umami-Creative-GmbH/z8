"use client";

import {
	IconBriefcase,
	IconCalendarTime,
	IconDatabase,
	IconGavel,
	IconLoader2,
	IconPercentage,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleOrganizationFeature } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

interface OrganizationFeaturesCardProps {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationFeaturesCard({
	organizationId,
	shiftsEnabled,
	projectsEnabled,
	surchargesEnabled,
	demoDataEnabled,
	worksCouncilEnabled,
	currentMemberRole,
}: OrganizationFeaturesCardProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [isPending, startTransition] = useTransition();
	const [isShiftsEnabled, setIsShiftsEnabled] = useState(shiftsEnabled);
	const [isProjectsEnabled, setIsProjectsEnabled] = useState(projectsEnabled);
	const [isSurchargesEnabled, setIsSurchargesEnabled] = useState(surchargesEnabled);
	const [isDemoDataEnabled, setIsDemoDataEnabled] = useState(demoDataEnabled);
	const [isWorksCouncilEnabled, setIsWorksCouncilEnabled] = useState(worksCouncilEnabled);
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);

	const canEdit = currentMemberRole === "owner";

	const handleToggleShifts = async (enabled: boolean) => {
		if (!canEdit) return;

		// Optimistic update
		setIsShiftsEnabled(enabled);
		setOrgSettings({ shiftsEnabled: enabled });

		const result = await toggleOrganizationFeature(organizationId, "shiftsEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.shifts-enabled", "Work Shifts enabled")
					: t("organization.features.shifts-disabled", "Work Shifts disabled"),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			// Revert optimistic update
			setIsShiftsEnabled(!enabled);
			setOrgSettings({ shiftsEnabled: !enabled });
			toast.error(
				result.error || t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	const handleToggleProjects = async (enabled: boolean) => {
		if (!canEdit) return;

		// Optimistic update
		setIsProjectsEnabled(enabled);
		setOrgSettings({ projectsEnabled: enabled });

		const result = await toggleOrganizationFeature(organizationId, "projectsEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.projects-enabled", "Projects enabled")
					: t("organization.features.projects-disabled", "Projects disabled"),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			// Revert optimistic update
			setIsProjectsEnabled(!enabled);
			setOrgSettings({ projectsEnabled: !enabled });
			toast.error(
				result.error || t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	const handleToggleSurcharges = async (enabled: boolean) => {
		if (!canEdit) return;

		// Optimistic update
		setIsSurchargesEnabled(enabled);
		setOrgSettings({ surchargesEnabled: enabled });

		const result = await toggleOrganizationFeature(organizationId, "surchargesEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.surcharges-enabled", "Surcharges enabled")
					: t("organization.features.surcharges-disabled", "Surcharges disabled"),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			// Revert optimistic update
			setIsSurchargesEnabled(!enabled);
			setOrgSettings({ surchargesEnabled: !enabled });
			toast.error(
				result.error || t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	const handleToggleWorksCouncil = async (enabled: boolean) => {
		if (!canEdit) return;

		setIsWorksCouncilEnabled(enabled);
		setOrgSettings({ worksCouncilEnabled: enabled });

		const result = await toggleOrganizationFeature(organizationId, "worksCouncilEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.works-council-enabled", "Works Council enabled")
					: t("organization.features.works-council-disabled", "Works Council disabled"),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			setIsWorksCouncilEnabled(!enabled);
			setOrgSettings({ worksCouncilEnabled: !enabled });
			toast.error(
				result.error || t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	const handleToggleDemoData = async (enabled: boolean) => {
		if (!canEdit) return;

		setIsDemoDataEnabled(enabled);
		setOrgSettings({ demoDataEnabled: enabled });

		const result = await toggleOrganizationFeature(organizationId, "demoDataEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.demo-data-enabled", "Demo Data enabled")
					: t("organization.features.demo-data-disabled", "Demo Data disabled"),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			setIsDemoDataEnabled(!enabled);
			setOrgSettings({ demoDataEnabled: !enabled });
			toast.error(
				result.error || t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.features.title", "Features")}</CardTitle>
				<CardDescription>
					{t(
						"organization.features.description",
						"Enable or disable optional features for your organization",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Work Shifts Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconCalendarTime className="size-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="shifts-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.work-shifts", "Work Shifts")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.work-shifts-description",
									"Enable work shifts with drag-and-drop planning, open shifts, and swap requests.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
						<Switch
							id="shifts-toggle"
							checked={isShiftsEnabled}
							onCheckedChange={handleToggleShifts}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-work-shifts", "Toggle work shifts")}
						/>
					</div>
				</div>

				{/* Projects Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconBriefcase className="size-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="projects-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.projects", "Projects")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.projects-description",
									"Assign time entries to projects, track budgets and deadlines, and generate project reports.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
						<Switch
							id="projects-toggle"
							checked={isProjectsEnabled}
							onCheckedChange={handleToggleProjects}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-projects", "Toggle projects")}
						/>
					</div>
				</div>

				{/* Surcharges Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconPercentage className="size-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="surcharges-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.surcharges", "Surcharges")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.surcharges-description",
									"Configure time surcharges for overtime, night work, weekends, and holidays.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
						<Switch
							id="surcharges-toggle"
							checked={isSurchargesEnabled}
							onCheckedChange={handleToggleSurcharges}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-surcharges", "Toggle surcharges")}
						/>
					</div>
				</div>

				{/* Works Council Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconGavel aria-hidden="true" className="size-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="works-council-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.works-council", "Works Council")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.works-council-description",
									"Enable the Works Council portal for authorized owners, admins, and assigned reviewers.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
						<Switch
							id="works-council-toggle"
							checked={isWorksCouncilEnabled}
							onCheckedChange={handleToggleWorksCouncil}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-works-council", "Toggle Works Council")}
						/>
					</div>
				</div>

				{/* Demo Data Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconDatabase className="size-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="demo-data-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.demo-data", "Demo Data")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.demo-data-description",
									"Allow admins to generate and clear sample organization data for testing.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
						<Switch
							id="demo-data-toggle"
							checked={isDemoDataEnabled}
							onCheckedChange={handleToggleDemoData}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-demo-data", "Toggle demo data")}
						/>
					</div>
				</div>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.features.owner-only",
							"Only organization owners can change feature settings.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
