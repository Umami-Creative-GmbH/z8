"use client";

import {
	IconBriefcase,
	IconCalendarTime,
	IconDatabase,
	IconFileText,
	IconGavel,
	IconLoader2,
	IconPercentage,
	IconReceipt,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useReducer, useState, useTransition } from "react";
import { toast } from "sonner";
import { switchBillableTime } from "@/app/[locale]/(app)/settings/billable-time/actions";
import { toggleOrganizationFeature } from "@/app/[locale]/(app)/settings/organizations/actions";
import { BillableCurrencyForm } from "@/components/billable-time/billable-currency-form";
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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import {
	type OrganizationFeature,
	type OrganizationFeatureState,
	organizationFeatureReducer,
} from "./organization-feature-state";

interface OrganizationFeaturesCardProps {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	billableTimeEnabled: boolean;
	/** The billable currency, or null until Billable Time was first switched on. */
	billableCurrency: BillableCurrency | null;
	personnelFilesEnabled: boolean;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationFeaturesCard({
	shiftsEnabled,
	projectsEnabled,
	surchargesEnabled,
	demoDataEnabled,
	worksCouncilEnabled,
	billableTimeEnabled,
	personnelFilesEnabled,
	...props
}: OrganizationFeaturesCardProps) {
	const initialFeatures = {
		shiftsEnabled,
		projectsEnabled,
		surchargesEnabled,
		demoDataEnabled,
		worksCouncilEnabled,
		billableTimeEnabled,
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

function useOrganizationFeatures({
	organizationId,
	currentMemberRole,
	billableCurrency,
	initialFeatures,
}: Omit<OrganizationFeaturesCardProps, OrganizationFeature> & {
	initialFeatures: OrganizationFeatureState;
}) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [isPending, startTransition] = useTransition();
	const [features, dispatch] = useReducer(organizationFeatureReducer, initialFeatures);
	const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);

	const canEdit = currentMemberRole === "owner";
	// Personnel files are switched by owners and admins (#865).
	const canEditPersonnelFiles = canEdit || currentMemberRole === "admin";
	const [confirmPersonnelFilesOff, setConfirmPersonnelFilesOff] = useState(false);

	const applyFeatures = (values: Partial<OrganizationFeatureState>) => {
		for (const [feature, enabled] of Object.entries(values) as [OrganizationFeature, boolean][]) {
			dispatch({ type: "set", feature, enabled });
		}
		setOrgSettings(values);
	};

	const handleToggleFeature = async (feature: OrganizationFeature, enabled: boolean) => {
		if (feature === "personnelFilesEnabled" ? !canEditPersonnelFiles : !canEdit) return;

		// Billable Time needs projects: the server switches it off with them (#897).
		const cascadesBillableTime = feature === "projectsEnabled" && !enabled;
		const previousBillableTime = features.billableTimeEnabled;
		applyFeatures(
			cascadesBillableTime
				? { [feature]: enabled, billableTimeEnabled: false }
				: { [feature]: enabled },
		);

		const result = await toggleOrganizationFeature(organizationId, feature, enabled);

		if (result.success) {
			toast.success(
				t(
					enabled
						? `organization.features.${feature}-enabled`
						: `organization.features.${feature}-disabled`,
					enabled ? "Feature enabled" : "Feature disabled",
				),
			);
			startTransition(() => {
				refresh();
			});
		} else {
			applyFeatures(
				cascadesBillableTime
					? { [feature]: !enabled, billableTimeEnabled: previousBillableTime }
					: { [feature]: !enabled },
			);
			toast.error(
				result.error || t("organization.features.update-failed", "Failed to update feature"),
			);
		}
	};

	const saveBillableTime = async (enabled: boolean, currency: BillableCurrency | null) => {
		if (!canEdit) return false;
		applyFeatures({ billableTimeEnabled: enabled });

		const result = await switchBillableTime({ enabled, currency });

		if (result.success) {
			toast.success(
				enabled
					? t("organization.features.billable-time-enabled", "Billable Time enabled")
					: t("organization.features.billable-time-disabled", "Billable Time disabled"),
			);
			startTransition(() => {
				refresh();
			});
			return true;
		}
		applyFeatures({ billableTimeEnabled: !enabled });
		toast.error(
			result.error || t("organization.features.update-failed", "Failed to update feature"),
		);
		return false;
	};

	const handleToggleBillableTime = async (enabled: boolean) => {
		if (!canEdit) return;
		// The first switch-on asks for the billable currency; later ones keep it.
		if (enabled && !billableCurrency) {
			setCurrencyDialogOpen(true);
			return;
		}
		await saveBillableTime(enabled, null);
	};

	return {
		t,
		isPending,
		features,
		handleToggleFeature,
		canEdit,
		billableCurrency,
		handleToggleBillableTime,
		currencyDialogOpen,
		setCurrencyDialogOpen,
		saveBillableTime,
		setConfirmPersonnelFilesOff,
		canEditPersonnelFiles,
		confirmPersonnelFilesOff,
	};
}

function OrganizationFeaturesCardContent({
	organizationId,
	currentMemberRole,
	billableCurrency,
	initialFeatures,
}: Omit<OrganizationFeaturesCardProps, OrganizationFeature> & {
	initialFeatures: OrganizationFeatureState;
}) {
	const {
		t,
		isPending,
		features,
		handleToggleFeature,
		canEdit,
		handleToggleBillableTime,
		currencyDialogOpen,
		setCurrencyDialogOpen,
		saveBillableTime,
		setConfirmPersonnelFilesOff,
		canEditPersonnelFiles,
		confirmPersonnelFilesOff,
	} = useOrganizationFeatures({
		organizationId,
		currentMemberRole,
		billableCurrency,
		initialFeatures,
	});
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
				<ShiftFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					canEdit={canEdit}
				/>

				{/* Projects Feature */}
				<ProjectFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					canEdit={canEdit}
				/>

				{/* Billable Time Feature (#897): needs projects */}
				<BillableTimeFeature
					t={t}
					features={features}
					billableCurrency={billableCurrency}
					isPending={isPending}
					handleToggleBillableTime={handleToggleBillableTime}
					canEdit={canEdit}
				/>

				<Dialog open={currencyDialogOpen} onOpenChange={setCurrencyDialogOpen}>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>
								{t("organization.features.billable-time-dialog-title", "Switch on Billable Time")}
							</DialogTitle>
							<DialogDescription>
								{t(
									"organization.features.billable-time-dialog-description",
									"Choose the currency your organization charges its customers in.",
								)}
							</DialogDescription>
						</DialogHeader>
						<BillableCurrencyForm
							disabled={!canEdit}
							onSubmit={async (currency) => {
								if (await saveBillableTime(true, currency)) {
									setCurrencyDialogOpen(false);
								}
							}}
						>
							{({ pending }) => (
								<DialogFooter>
									<Button
										type="button"
										variant="outline"
										onClick={() => setCurrencyDialogOpen(false)}
										disabled={pending}
									>
										{t("common.cancel", "Cancel")}
									</Button>
									<Button type="submit" disabled={!canEdit || pending}>
										{pending && (
											<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
										)}
										{t("organization.features.billable-time-dialog-confirm", "Switch on")}
									</Button>
								</DialogFooter>
							)}
						</BillableCurrencyForm>
					</DialogContent>
				</Dialog>

				{/* Surcharges Feature */}
				<SurchargeFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					canEdit={canEdit}
				/>

				{/* Works Council Feature */}
				<WorksCouncilFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					canEdit={canEdit}
				/>

				{/* Demo Data Feature */}
				<DemoFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					canEdit={canEdit}
				/>

				{/* Personnel Files Feature */}
				<PersonnelFileFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					setConfirmPersonnelFilesOff={setConfirmPersonnelFilesOff}
					canEditPersonnelFiles={canEditPersonnelFiles}
				/>

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

function ShiftFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	canEdit,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	"t" | "isPending" | "features" | "handleToggleFeature" | "canEdit"
>) {
	return (
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
	);
}

function ProjectFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	canEdit,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	"t" | "isPending" | "features" | "handleToggleFeature" | "canEdit"
>) {
	return (
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
	);
}

function BillableTimeFeature({
	t,
	features,
	billableCurrency,
	isPending,
	handleToggleBillableTime,
	canEdit,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	"t" | "features" | "billableCurrency" | "isPending" | "handleToggleBillableTime" | "canEdit"
>) {
	return (
		<div className="flex items-center justify-between">
			<div className="flex items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
					<IconReceipt aria-hidden="true" className="size-5 text-primary" />
				</div>
				<div className="space-y-1">
					<Label
						htmlFor="billable-time-toggle"
						className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
					>
						{t("organization.features.billable-time", "Billable Time")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.features.billable-time-description",
							"Price work on customer projects with billable rates and hand it to your accounting tool as invoice drafts.",
						)}
					</p>
					{!features.projectsEnabled && (
						<p className="text-sm text-muted-foreground">
							{t(
								"organization.features.billable-time-requires-projects",
								"Requires Projects. Switching Projects off also switches Billable Time off; its settings are kept.",
							)}
						</p>
					)}
					{billableCurrency && (
						<p className="text-sm text-muted-foreground">
							{t("organization.features.billable-time-currency", "Billable currency: {currency}", {
								currency: billableCurrency,
							})}
						</p>
					)}
				</div>
			</div>
			<div className="flex items-center gap-2">
				{isPending && <IconLoader2 className="size-4 animate-spin text-muted-foreground" />}
				<Switch
					id="billable-time-toggle"
					checked={features.billableTimeEnabled && features.projectsEnabled}
					onCheckedChange={(enabled) => void handleToggleBillableTime(enabled)}
					disabled={!canEdit || isPending || !features.projectsEnabled}
					aria-label={t("organization.features.toggle-billable-time", "Toggle Billable Time")}
				/>
			</div>
		</div>
	);
}

function SurchargeFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	canEdit,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	"t" | "isPending" | "features" | "handleToggleFeature" | "canEdit"
>) {
	return (
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
	);
}

function WorksCouncilFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	canEdit,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	"t" | "isPending" | "features" | "handleToggleFeature" | "canEdit"
>) {
	return (
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
	);
}

function DemoFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	canEdit,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	"t" | "isPending" | "features" | "handleToggleFeature" | "canEdit"
>) {
	return (
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
	);
}

function PersonnelFileFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	setConfirmPersonnelFilesOff,
	canEditPersonnelFiles,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	| "t"
	| "isPending"
	| "features"
	| "handleToggleFeature"
	| "setConfirmPersonnelFilesOff"
	| "canEditPersonnelFiles"
>) {
	return (
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
					aria-label={t("organization.features.toggle-personnel-files", "Toggle personnel files")}
				/>
			</div>
		</div>
	);
}
