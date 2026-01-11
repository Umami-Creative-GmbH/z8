"use client";

import { IconBriefcase, IconCalendarTime, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleOrganizationFeature } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface OrganizationFeaturesCardProps {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationFeaturesCard({
	organizationId,
	shiftsEnabled,
	projectsEnabled,
	currentMemberRole,
}: OrganizationFeaturesCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [isShiftsEnabled, setIsShiftsEnabled] = useState(shiftsEnabled);
	const [isProjectsEnabled, setIsProjectsEnabled] = useState(projectsEnabled);

	const canEdit = currentMemberRole === "owner";

	const handleToggleShifts = async (enabled: boolean) => {
		if (!canEdit) return;

		// Optimistic update
		setIsShiftsEnabled(enabled);

		const result = await toggleOrganizationFeature(organizationId, "shiftsEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.shifts-enabled", "Shift scheduling enabled")
					: t("organization.features.shifts-disabled", "Shift scheduling disabled"),
			);
			startTransition(() => {
				router.refresh();
			});
		} else {
			// Revert optimistic update
			setIsShiftsEnabled(!enabled);
			toast.error(
				result.error?.message ||
					t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	const handleToggleProjects = async (enabled: boolean) => {
		if (!canEdit) return;

		// Optimistic update
		setIsProjectsEnabled(enabled);

		const result = await toggleOrganizationFeature(organizationId, "projectsEnabled", enabled);

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.projects-enabled", "Projects enabled")
					: t("organization.features.projects-disabled", "Projects disabled"),
			);
			startTransition(() => {
				router.refresh();
			});
		} else {
			// Revert optimistic update
			setIsProjectsEnabled(!enabled);
			toast.error(
				result.error?.message ||
					t("organization.features.update-failed", "Failed to update feature"),
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
				{/* Shift Scheduling Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconCalendarTime className="h-5 w-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="shifts-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.shift-scheduling", "Shift Scheduling")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.shift-scheduling-description",
									"Enable shift scheduling with drag-and-drop planning, open shifts, and swap requests.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
						<Switch
							id="shifts-toggle"
							checked={isShiftsEnabled}
							onCheckedChange={handleToggleShifts}
							disabled={!canEdit || isPending}
							aria-label={t(
								"organization.features.toggle-shift-scheduling",
								"Toggle shift scheduling",
							)}
						/>
					</div>
				</div>

				{/* Projects Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconBriefcase className="h-5 w-5 text-primary" />
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
						{isPending && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
						<Switch
							id="projects-toggle"
							checked={isProjectsEnabled}
							onCheckedChange={handleToggleProjects}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-projects", "Toggle projects")}
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
