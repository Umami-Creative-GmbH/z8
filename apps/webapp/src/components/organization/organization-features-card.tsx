"use client";

import {
	IconBriefcase,
	IconCalendarTime,
	IconDatabase,
	IconFileText,
	IconGavel,
	IconLoader2,
	IconPercentage,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useReducer, useState, useTransition } from "react";
import { toast } from "sonner";
import { toggleOrganizationFeature } from "@/app/[locale]/(app)/settings/organizations/actions";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import {
	organizationFeatureReducer,
	type OrganizationFeature,
	type OrganizationFeatureState,
} from "./organization-feature-state";

interface OrganizationFeaturesCardProps {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	personnelFilesEnabled: boolean;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationFeaturesCard({
	shiftsEnabled,
	projectsEnabled,
	surchargesEnabled,
	demoDataEnabled,
	worksCouncilEnabled,
	personnelFilesEnabled,
	...props
}: OrganizationFeaturesCardProps) {
	const initialFeatures = {
		shiftsEnabled,
		projectsEnabled,
		surchargesEnabled,
		demoDataEnabled,
		worksCouncilEnabled,
		personnelFilesEnabled,
	};

	return (
		<OrganizationFeaturesCardContent
			key={Object.values(initialFeatures).join(":")}
			{...props}
			initialFeatures={initialFeatures}
		/>
	);
}

function OrganizationFeaturesCardContent({
	organizationId,
	currentMemberRole,
	initialFeatures,
}: Omit<OrganizationFeaturesCardProps, OrganizationFeature> & {
	initialFeatures: OrganizationFeatureState;
}) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [isPending, startTransition] = useTransition();
	const [features, dispatch] = useReducer(organizationFeatureReducer, initialFeatures);
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);

	const canEdit = currentMemberRole === "owner";
	// Personnel files are switched by owners and admins (#865).
	const canEditPersonnelFiles = canEdit || currentMemberRole === "admin";
	const [confirmPersonnelFilesOff, setConfirmPersonnelFilesOff] = useState(false);

	const handleToggleFeature = async (feature: OrganizationFeature, enabled: boolean) => {
		if (feature === "personnelFilesEnabled" ? !canEditPersonnelFiles : !canEdit) return;

		dispatch({ type: "set", feature, enabled });
		setOrgSettings({ [feature]: enabled });

		const result = await toggleOrganizationFeature(organizationId, feature, enabled);

		if (result.success) {
			toast.success(
				t(
					enabled ? `organization.features.${feature}-enabled` : `organization.features.${feature}-disabled`,
					enabled ? "Feature enabled" : "Feature disabled",
				),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			dispatch({ type: "set", feature, enabled: !enabled });
			setOrgSettings({ [feature]: !enabled });
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
							checked={features.shiftsEnabled}
							onCheckedChange={(enabled) => handleToggleFeature("shiftsEnabled", enabled)}
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
							checked={features.projectsEnabled}
							onCheckedChange={(enabled) => handleToggleFeature("projectsEnabled", enabled)}
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
							checked={features.surchargesEnabled}
							onCheckedChange={(enabled) => handleToggleFeature("surchargesEnabled", enabled)}
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
							checked={features.worksCouncilEnabled}
							onCheckedChange={(enabled) => handleToggleFeature("worksCouncilEnabled", enabled)}
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
							checked={features.demoDataEnabled}
							onCheckedChange={(enabled) => handleToggleFeature("demoDataEnabled", enabled)}
							disabled={!canEdit || isPending}
							aria-label={t("organization.features.toggle-demo-data", "Toggle demo data")}
						/>
					</div>
				</div>

				{/* Personnel Files Feature */}
				<div className="flex items-center justify-between">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
							<IconFileText aria-hidden="true" className="size-5 text-primary" />
						</div>
						<div className="space-y-1">
							<Label
								htmlFor="personnel-files-toggle"
								className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
							>
								{t("organization.features.personnel-files", "Personnel Files")}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"organization.features.personnel-files-description",
									"Keep contracts, payslips, certificates and other employee documents in a personnel file per employee.",
								)}
							</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
						<Switch
							id="personnel-files-toggle"
							checked={features.personnelFilesEnabled}
							onCheckedChange={(enabled) => {
								if (enabled) {
									void handleToggleFeature("personnelFilesEnabled", true);
								} else {
									setConfirmPersonnelFilesOff(true);
								}
							}}
							disabled={!canEditPersonnelFiles || isPending}
							aria-label={t(
								"organization.features.toggle-personnel-files",
								"Toggle personnel files",
							)}
						/>
					</div>
				</div>

				<AlertDialog open={confirmPersonnelFilesOff} onOpenChange={setConfirmPersonnelFilesOff}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{t(
									"organization.features.personnel-files-disable-title",
									"Turn off personnel files?",
								)}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{t(
									"organization.features.personnel-files-disable-description",
									"Personnel file pages and downloads are hidden for everyone. Documents stay stored and still count for retention. Turning personnel files back on restores everything.",
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => void handleToggleFeature("personnelFilesEnabled", false)}
							>
								{t("organization.features.personnel-files-disable-confirm", "Turn off")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{canEditPersonnelFiles
							? t(
									"organization.features.owner-only-except-personnel-files",
									"Only organization owners can change feature settings, except personnel files.",
								)
							: t(
									"organization.features.owner-only",
									"Only organization owners can change feature settings.",
								)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
