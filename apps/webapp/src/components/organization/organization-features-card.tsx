"use client";

import {
	IconAlertTriangle,
	IconBriefcase,
	IconCalendarTime,
	IconDatabase,
	IconFileText,
	IconGavel,
	IconLoader2,
	IconPackage,
	IconPercentage,
	IconReceipt,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { switchBillableTime } from "@/app/[locale]/(app)/settings/billable-time/actions";
import { toggleOrganizationFeature } from "@/app/[locale]/(app)/settings/organization/actions";
import { BillableCurrencyForm } from "@/components/billable-time/billable-currency-form";
import {
	ConfirmActionDialog,
	describeFailure,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
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
import { useServerDataState } from "@/hooks/use-server-data-state";
import type { BillableCurrency } from "@/lib/billable-time/currency";
import type { DrivingLicenceFeatureState } from "@/lib/organization/driving-licence/policy";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { DrivingLicenceFeature } from "./driving-licence-feature";
import {
	type OrganizationFeature,
	type OrganizationFeatureState,
	organizationFeatureReducer,
} from "./organization-feature-state";

interface OrganizationFeaturesCardProps {
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	worksCouncilEnabled: boolean;
	billableTimeEnabled: boolean;
	/** The billable currency, or null until Billable Time was first switched on. */
	billableCurrency: BillableCurrency | null;
	personnelFilesEnabled: boolean;
	/** Equipment tracking (#1572). */
	equipmentEnabled: boolean;
	/** Assignments with an outstanding return, for the switch-off warning. */
	equipmentOutstandingReturns?: number;
	/** Driving licence control (#1421): the policy's on/off, read on the server. */
	drivingLicence?: DrivingLicenceFeatureState;
	/** Prefills the driving licence deadline timezone on its first switch-on. */
	organizationTimezone?: string;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
}

export function OrganizationFeaturesCard({
	shiftsEnabled,
	projectsEnabled,
	surchargesEnabled,
	demoDataEnabled,
	worksCouncilEnabled,
	billableTimeEnabled,
	personnelFilesEnabled,
	equipmentEnabled,
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
		equipmentEnabled,
	};

	return <OrganizationFeaturesCardContent {...props} initialFeatures={initialFeatures} />;
}

function useOrganizationFeatures({
	settingsAccess,
	billableCurrency,
	initialFeatures,
}: Omit<OrganizationFeaturesCardProps, OrganizationFeature> & {
	initialFeatures: OrganizationFeatureState;
}) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [isPending, startTransition] = useTransition();
	const [features, setFeatures] = useServerDataState(initialFeatures);
	const dispatch = (action: Parameters<typeof organizationFeatureReducer>[1]) =>
		setFeatures((current) => organizationFeatureReducer(current, action));
	const [currencyDialogOpen, setCurrencyDialogOpen] = useState(false);
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);

	const canEdit = meetsSettingsAccess(settingsAccess, "owner");
	// Personnel files are switched by org admins and owners (#865).
	const canEditPersonnelFiles = meetsSettingsAccess(settingsAccess, "orgAdmin");
	// Driving licence control (#1421) and equipment tracking (#1572) too: the same
	// owner-or-admin rule, under their own names.
	const canSwitchDrivingLicence = canEditPersonnelFiles;
	const canEditEquipment = canEditPersonnelFiles;

	const applyFeatures = (values: Partial<OrganizationFeatureState>) => {
		for (const [feature, enabled] of Object.entries(values) as [OrganizationFeature, boolean][]) {
			dispatch({ type: "set", feature, enabled });
		}
		setOrgSettings(values);
	};

	/** Switches one feature; resolves to the worded failure, or null once it is saved. */
	const toggleFeature = async (
		feature: OrganizationFeature,
		enabled: boolean,
	): Promise<string | null> => {
		const allowed =
			feature === "personnelFilesEnabled"
				? canEditPersonnelFiles
				: feature === "equipmentEnabled"
					? canEditEquipment
					: canEdit;
		if (!allowed) return null;

		// Billable Time needs projects: the server switches it off with them (#897).
		const cascadesBillableTime = feature === "projectsEnabled" && !enabled;
		const previousBillableTime = features.billableTimeEnabled;
		applyFeatures(
			cascadesBillableTime
				? { [feature]: enabled, billableTimeEnabled: false }
				: { [feature]: enabled },
		);

		const result = await toggleOrganizationFeature({ feature, enabled }).catch(() => null);

		if (result?.success) {
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
			return null;
		}
		applyFeatures(
			cascadesBillableTime
				? { [feature]: !enabled, billableTimeEnabled: previousBillableTime }
				: { [feature]: !enabled },
		);
		return result?.error || t("organization.features.update-failed", "Failed to update feature");
	};

	const handleToggleFeature = async (feature: OrganizationFeature, enabled: boolean) => {
		const failure = await toggleFeature(feature, enabled);
		if (failure) toast.error(failure);
	};

	// Switching a feature off behind a confirmation keeps the dialog open until the
	// change is saved and shows a failure inside it.
	const featureOff = useConfirmedAction<"personnelFilesEnabled" | "equipmentEnabled">();
	const confirmFeatureOff = () =>
		void featureOff.confirm(
			async (feature) => {
				const failure = await toggleFeature(feature, false);
				if (failure) throw new Error(failure);
			},
			(failure) =>
				describeFailure(
					failure,
					t("organization.features.update-failed", "Failed to update feature"),
				),
		);

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
		canEditPersonnelFiles,
		canSwitchDrivingLicence,
		canEditEquipment,
		featureOff,
		confirmFeatureOff,
		setConfirmPersonnelFilesOff: (open: boolean) => {
			if (open) featureOff.request("personnelFilesEnabled");
		},
		setConfirmEquipmentOff: (open: boolean) => {
			if (open) featureOff.request("equipmentEnabled");
		},
	};
}

function OrganizationFeaturesCardContent({
	settingsAccess,
	billableCurrency,
	drivingLicence,
	organizationTimezone,
	equipmentOutstandingReturns = 0,
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
		canEditPersonnelFiles,
		canSwitchDrivingLicence,
		canEditEquipment,
		featureOff,
		confirmFeatureOff,
		setConfirmPersonnelFilesOff,
		setConfirmEquipmentOff,
	} = useOrganizationFeatures({
		settingsAccess,
		billableCurrency,
		initialFeatures,
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					<h2>{t("organization.features.title", "Features")}</h2>
				</CardTitle>
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

				<ConfirmActionDialog
					open={featureOff.open && featureOff.target === "personnelFilesEnabled"}
					onOpenChange={featureOff.onOpenChange}
					variant="default"
					title={t(
						"organization.features.personnel-files-disable-title",
						"Turn off personnel files?",
					)}
					description={t(
						"organization.features.personnel-files-disable-description",
						"Personnel file pages and downloads are hidden for everyone. Documents stay stored and still count for retention. Turning personnel files back on restores everything.",
					)}
					confirmLabel={t("organization.features.personnel-files-disable-confirm", "Turn off")}
					isPending={featureOff.isPending}
					error={featureOff.error}
					onConfirm={confirmFeatureOff}
				/>

				{/* Equipment Tracking Feature (#1572): owners and admins */}
				<EquipmentFeature
					t={t}
					isPending={isPending}
					features={features}
					handleToggleFeature={handleToggleFeature}
					setConfirmEquipmentOff={setConfirmEquipmentOff}
					canEditEquipment={canEditEquipment}
				/>

				<ConfirmActionDialog
					open={featureOff.open && featureOff.target === "equipmentEnabled"}
					onOpenChange={featureOff.onOpenChange}
					variant="default"
					title={t("organization.features.equipment-disable-title", "Turn off equipment?")}
					description={t(
						"organization.features.equipment-disable-description",
						"Equipment pages are hidden for everyone and return reminders stop. All equipment records, outstanding returns and record retention stay in place. Turning equipment back on restores everything.",
					)}
					confirmLabel={t("organization.features.equipment-disable-confirm", "Turn off")}
					isPending={featureOff.isPending}
					error={featureOff.error}
					onConfirm={confirmFeatureOff}
				>
					{equipmentOutstandingReturns > 0 && (
						<div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
							<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
							<p>
								{t(
									"organization.features.equipment-disable-outstanding",
									"{count, plural, one {# return is still outstanding. It stays recorded, but nobody can record its receipt while equipment is off.} other {# returns are still outstanding. They stay recorded, but nobody can record receipts while equipment is off.}}",
									{ count: equipmentOutstandingReturns },
								)}
							</p>
						</div>
					)}
				</ConfirmActionDialog>

				{/* Driving Licence Control (#1421): owners and admins, the feature's only activation */}
				{drivingLicence && (
					<DrivingLicenceFeature
						state={drivingLicence}
						organizationTimezone={organizationTimezone ?? "UTC"}
						canEdit={canSwitchDrivingLicence}
					/>
				)}

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{canEditPersonnelFiles
							? drivingLicence
								? t(
										"organization.features.owner-only-except-admin-managed-features",
										"Only organization owners can change feature settings, except personnel files, equipment and driving licence control.",
									)
								: t(
										"organization.features.owner-only-except-personnel-files-equipment",
										"Only organization owners can change feature settings, except personnel files and equipment.",
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
					<IconCalendarTime aria-hidden="true" className="size-5 text-primary" />
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
					<IconBriefcase aria-hidden="true" className="size-5 text-primary" />
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
					<IconPercentage aria-hidden="true" className="size-5 text-primary" />
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
					<IconDatabase aria-hidden="true" className="size-5 text-primary" />
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
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
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
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

function EquipmentFeature({
	t,
	isPending,
	features,
	handleToggleFeature,
	setConfirmEquipmentOff,
	canEditEquipment,
}: Pick<
	ReturnType<typeof useOrganizationFeatures>,
	| "t"
	| "isPending"
	| "features"
	| "handleToggleFeature"
	| "setConfirmEquipmentOff"
	| "canEditEquipment"
>) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 items-start gap-3">
				<div className="mt-0.5 rounded-lg bg-primary/10 p-2">
					<IconPackage aria-hidden="true" className="size-5 text-primary" />
				</div>
				<div className="space-y-1">
					<Label
						htmlFor="equipment-toggle"
						className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
					>
						{t("organization.features.equipment", "Equipment")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"organization.features.equipment-description",
							"Track equipment issued to employees and what must come back.",
						)}
					</p>
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				{isPending && (<IconLoader2 aria-hidden="true" className="size-4 animate-spin text-muted-foreground" />)}
				<Switch
					id="equipment-toggle"
					checked={features.equipmentEnabled}
					onCheckedChange={(enabled) => {
						if (enabled) {
							void handleToggleFeature("equipmentEnabled", true);
						} else {
							setConfirmEquipmentOff(true);
						}
					}}
					disabled={!canEditEquipment || isPending}
					aria-label={t("organization.features.toggle-equipment", "Toggle equipment")}
				/>
			</div>
		</div>
	);
}
