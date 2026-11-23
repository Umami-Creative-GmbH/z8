"use client";

import { IconCoin, IconReceipt2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { use, useEffect, useState } from "react";
import { toast } from "sonner";
import { BillableRateSeries } from "@/components/billable-time/billable-rate-series";
import { CostRateSeries } from "@/components/billable-time/cost-rate-series";
import { EmployeeEquipment } from "@/components/equipment/equipment-workspace";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { EmployeeLifecycleActions } from "@/components/organization/employee-lifecycle-actions";
import { ReactivationChecklistCard } from "@/components/organization/reactivation-checklist";
import { PersonnelFilePanel } from "@/components/personnel-file/personnel-file-panel";
import { EmployeeAssignedLocationsCard } from "@/components/settings/assigned-locations/employee-assigned-locations-card";
import { EmployeeContractTab } from "@/components/settings/contracts/employee-contract-tab";
import { ScopedManagerPolicyCard } from "@/components/settings/contracts/scoped-manager-policy-card";
import { ShortTermMonitorCard } from "@/components/settings/contracts/short-term-monitor-card";
import { WorkingStudentMonitorCard } from "@/components/settings/contracts/working-student-monitor-card";
import { CustomFieldDraftsSection } from "@/components/settings/custom-fields/custom-field-values-section";
import { useCustomFieldDrafts } from "@/components/settings/custom-fields/use-custom-field-drafts";
import { EmployeeCustomRolesCard } from "@/components/settings/custom-roles/employee-custom-roles-card";
import { EmploymentLifecycleEvents } from "@/components/settings/employee-employment-history/lifecycle-events";
import { WageHistoryMergeNote } from "@/components/settings/employee-employment-history/wage-history-merge-note";
import { EmployeeEmploymentHistoryCard } from "@/components/settings/employee-employment-history-card";
import { EmployeeOffboardingSection } from "@/components/settings/employee-offboarding/employee-offboarding-section";
import { LeavingDatePanel } from "@/components/settings/employee-offboarding/leaving-date-panel";
import { EmployeeSkillsCard } from "@/components/settings/employee-skills-card";
import { EmployeeTrackingDateCard } from "@/components/settings/employee-tracking-date-card";
import { EmploymentDateCorrectionCard } from "@/components/settings/employment-date-correction-card";
import { EmployeeKioskCard } from "@/components/settings/kiosk/employee-kiosk-card";
import { ManagerAssignment } from "@/components/settings/manager-assignment";
import { EmployeePersonalDataExportCard } from "@/components/settings/personal-data-export/employee-personal-data-export-card";
import { EmployeeWorkBalanceSection } from "@/components/settings/work-balance/employee-work-balance-section";
import { EMPLOYEE_WORK_BALANCE_QUERY_KEY } from "@/components/settings/work-balance/use-employee-work-balance";
import { WorkBalanceRecalculationCard } from "@/components/settings/work-balance-recalculation-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import type { EmployeeReadSnapshot } from "@/lib/organization/employee-read-types";
import type { EquipmentView } from "@/lib/organization/equipment/contracts";
import type { PersonnelFilePanelCapability } from "@/lib/personnel-file/panel";
import { queryKeys } from "@/lib/query";
import { type EmployeeDetail, useEmployee } from "@/lib/query/use-employee";
import { useRouter } from "@/navigation";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";
import { EmployeeDraftActions } from "./employee-draft-actions";
import type { EmployeeTeamOption } from "./employee-edit-form-card";
import { EmployeeDetailHeader, EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";
import type { EmployeeDetailFormApi } from "./page-utils";
import { useEmployeeDetailForm } from "./use-employee-detail-form";

export type EmployeeDetailTab =
	| "overview"
	| "contract"
	| "time-balance"
	| "assignments"
	| "offboarding"
	| "personnel-file";

/** Resolves the initial tab from `#employment-history`, `#offboarding`, and `?review=<id>` deep links. */
export function resolveEmployeeDetailTabFromDeepLink(input: {
	hash: string;
	highlightedReviewId: string | null;
	hasPersonnelFile: boolean;
	canViewOffboarding?: boolean;
}): EmployeeDetailTab {
	const canViewOffboarding = input.canViewOffboarding ?? true;
	if (input.highlightedReviewId) return canViewOffboarding ? "offboarding" : "overview";
	const normalized = input.hash.toLowerCase();
	if (normalized === "#offboarding" || normalized.startsWith("#offboarding-")) {
		return canViewOffboarding ? "offboarding" : "overview";
	}
	if (normalized === "#employment-history" || normalized === "#contract") {
		return "contract";
	}
	if (normalized === "#time-balance") {
		return "time-balance";
	}
	if (normalized === "#assignments") {
		return "assignments";
	}
	if (normalized === "#personnel-file" && input.hasPersonnelFile) {
		return "personnel-file";
	}
	return "overview";
}

function EmployeeDetailLifecycleActions({
	employee,
	currentUserId,
	settingsAccess,
}: {
	employee: EmployeeDetail;
	currentUserId: string;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	if (employee.kind !== "employee") return null;

	const updateLifecycleDetail = (
		targetEmployeeId: string,
		updates: Pick<EmployeeDetail, "isActive" | "membership">,
	) => {
		if (employee.id !== targetEmployeeId) return;
		queryClient.setQueryData<EmployeeReadSnapshot<"detail">>(
			queryKeys.employees.detailFor(currentUserId, employee.organizationId, targetEmployeeId),
			(current) =>
				current?.data.kind === "employee" && current.data.id === targetEmployeeId
					? // The former mark follows at once (#1438); the date arrives with the next read.
						{
							...current,
							data: {
								...current.data,
								...updates,
								isFormer: !updates.isActive,
								formerSince: undefined,
							},
						}
					: current,
		);
	};

	return (
		<div className="flex w-full flex-wrap items-center justify-start gap-3 sm:w-auto sm:justify-end">
			{!employee.isActive && !employee.membership && (
				<p className="max-w-sm text-left text-sm text-muted-foreground sm:text-right">
					{t(
						"settings.employees.lifecycle.reinviteRequired",
						"This employee no longer has organization membership. Send a new invitation to restore access.",
					)}
				</p>
			)}
			<EmployeeLifecycleActions
				organizationId={employee.organizationId}
				target={{
					employeeId: employee.id,
					userId: employee.userId,
					displayName: buildAuthUserDisplayName(employee.user) || employee.id,
					isActive: employee.isActive,
					membership: employee.membership,
				}}
				currentUserId={currentUserId}
				settingsAccess={settingsAccess}
				onOptimisticStatusChange={(targetEmployeeId, isActive) =>
					updateLifecycleDetail(targetEmployeeId, {
						isActive,
						membership: employee.membership,
					})
				}
				onRemoved={(targetEmployeeId) =>
					updateLifecycleDetail(targetEmployeeId, {
						isActive: false,
						membership: null,
					})
				}
			/>
		</div>
	);
}

export function EmployeeDetailPageClient({
	params,
	currentUserId,
	settingsAccess,
	organizationId,
	organizationTimezone = "UTC",
	initialSnapshot,
	highlightedReviewId = null,
	personnelFile = null,
	equipment = null,
}: {
	params: Promise<{ employeeId: string }>;
	currentUserId: string;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
	organizationId?: string;
	organizationTimezone?: string;
	initialSnapshot?: EmployeeReadSnapshot<"detail">;
	highlightedReviewId?: string | null;
	/** Decided on the server by the personnel file access resolver (#865). */
	personnelFile?: PersonnelFilePanelCapability | null;
	equipment?: EquipmentView | null;
}) {
	const { employeeId } = use(params);
	const { t } = useTranslate();
	const { push } = useRouter();
	const queryClient = useQueryClient();

	const isOrgAdmin = meetsSettingsAccess(settingsAccess, "orgAdmin");
	const hasPersonnelFile = Boolean(personnelFile);
	const [activeTab, setActiveTab] = useState<EmployeeDetailTab>(() =>
		resolveEmployeeDetailTabFromDeepLink({
			hash: typeof window !== "undefined" ? window.location.hash : "",
			highlightedReviewId,
			hasPersonnelFile,
			canViewOffboarding: isOrgAdmin,
		}),
	);

	// React to hash navigation (`#employment-history`, `#offboarding`, etc.) and `?review=<id>`.
	useEffect(() => {
		const syncFromLocation = () => {
			const hash = window.location.hash;
			const resolved = resolveEmployeeDetailTabFromDeepLink({
				hash,
				highlightedReviewId,
				hasPersonnelFile,
				canViewOffboarding: isOrgAdmin,
			});
			if (hash || highlightedReviewId) {
				setActiveTab(resolved);
				const targetId = highlightedReviewId
					? `offboarding-review-${highlightedReviewId}`
					: hash.slice(1);
				if (targetId) {
					requestAnimationFrame(() => {
						const el = document.getElementById(targetId);
						if (el && typeof el.scrollIntoView === "function") {
							el.scrollIntoView({ behavior: "smooth", block: "start" });
						}
					});
				}
			}
		};

		syncFromLocation();
		window.addEventListener("hashchange", syncFromLocation);
		return () => window.removeEventListener("hashchange", syncFromLocation);
	}, [highlightedReviewId, hasPersonnelFile, isOrgAdmin]);

	const employeeData = useEmployee({
		employeeId,
		settingsAccess,
		userId: currentUserId,
		organizationId,
		initialSnapshot,
	});
	const { employee, isLoading, hasEmployee, updateEmployee, isUpdating } = employeeData;
	// The "Custom fields" section (#818), saved with the employee details.
	const customFields = useCustomFieldDrafts({
		entity: "employee",
		recordId: employeeId,
		enabled: employee?.kind === "employee",
		readScope: organizationId ? { userId: currentUserId, organizationId } : undefined,
	});
	const { form, teamOptions, drivingLicenceWarning } = useEmployeeDetailForm({
		employeeId,
		settingsAccess,
		employee,
		updateEmployee,
		customFields,
	});

	if (!hasEmployee && !isLoading && !employeeData.isError) {
		return <EmployeeDetailMissing />;
	}

	if (employeeData.isError) {
		return <EmployeeDetailLoadError data={employeeData} />;
	}
	if (isLoading || !employee) {
		return <EmployeeDetailLoading />;
	}

	const isDraft = employee.kind === "invitationDraft";
	const canShowRealEmployeeSections = !isDraft;
	const canEditDraftDetails = !isDraft || !employee.realEmployeeId;
	const isOrgAdminOrManager = meetsSettingsAccess(settingsAccess, "scopedManager");
	const { availableManagers, workPolicies } = employeeData;

	const handleWorkBalanceRecalculation = async () => {
		const result = await employeeData.requestWorkBalanceRecalculation().catch(() => null);

		if (result?.success) {
			toast.success(
				t("settings.workBalanceRecalculation.requestSuccess", "Work balance recalculation queued"),
			);
			return;
		}

		toast.error(
			result?.error ||
				t(
					"settings.workBalanceRecalculation.requestError",
					"Failed to queue work balance recalculation",
				),
		);
	};

	const editForm = (
		<EmployeeDetailEditCard
			form={form}
			employee={employee}
			settingsAccess={settingsAccess}
			isUpdating={isUpdating}
			teamOptions={teamOptions}
			customFields={customFields}
			onCancel={() => push("/settings/employees")}
		/>
	);

	return (
		<div className="page-frame">
			<div className="page-measure flex flex-col gap-6">
				{drivingLicenceWarning}
				<EmployeeDetailHeader
					t={t}
					employeeName={buildAuthUserDisplayName(employee.user)}
					actions={
						<EmployeeDetailLifecycleActions
							employee={employee}
							currentUserId={currentUserId}
							settingsAccess={settingsAccess}
						/>
					}
				/>

				{canShowRealEmployeeSections ? (
					<Tabs
						value={activeTab}
						onValueChange={(value) => setActiveTab(value as EmployeeDetailTab)}
						className="min-w-0 gap-4"
					>
						<div className="max-w-full overflow-x-auto">
							<TabsList
								aria-label={t(
									"settings.employees.detailView.tabsAriaLabel",
									"Employee detail sections",
								)}
							>
								<TabsTrigger value="overview">
									{t("settings.employees.detailView.tabs.overview", "Overview")}
								</TabsTrigger>
								<TabsTrigger value="contract">
									{isOrgAdmin
										? t("settings.employees.detailView.tabs.contract", "Contract")
										: t("settings.employees.detailView.tabs.workPolicy", "Work policy")}
								</TabsTrigger>
								<TabsTrigger value="time-balance">
									{t("settings.employees.detailView.tabs.timeBalance", "Time & Balance")}
								</TabsTrigger>
								<TabsTrigger value="assignments">
									{t("settings.employees.detailView.tabs.assignments", "Access & Roles")}
								</TabsTrigger>
								{isOrgAdmin && (
									<TabsTrigger value="offboarding">
										{t("settings.employees.detailView.tabs.leavingDate", "Leaving Date")}
									</TabsTrigger>
								)}
								{personnelFile && (
									<TabsTrigger value="personnel-file">
										{t("settings.personnelFiles.panel.tab", "Personnel file")}
									</TabsTrigger>
								)}
							</TabsList>
						</div>

						{/* Tab 1: Overview */}
						<TabsContent value="overview" className="flex flex-col gap-4">
							<EmployeeReadNotices data={employeeData} />
							<div className="grid gap-4 lg:grid-cols-3">
								<EmployeeOverviewCard employee={employee} schedule={employeeData.schedule} t={t} />
								{canEditDraftDetails && editForm}
							</div>
							{isOrgAdmin && <ReactivationChecklistCard employeeId={employeeId} />}
							{equipment ? (
								<EmployeeEquipment
									key={`${organizationId}:${employeeId}`}
									data={equipment}
									employeeId={employeeId}
								/>
							) : null}
						</TabsContent>

						{/* Tab 2: Contract (Org Admin) or Wage-Free Work Policy (Scoped Manager A1) */}
						<TabsContent value="contract" className="flex flex-col gap-4">
							{isOrgAdmin ? (
								<>
									<EmployeeContractTab
										organizationId={employee.organizationId}
										organizationTimezone={organizationTimezone}
										employeeId={employeeId}
										workPolicies={workPolicies}
										employmentHistory={employeeData.employmentHistory}
										onContractMutated={() => void employeeData.refetch()}
									/>
									<EmploymentDateCorrectionCard
										key={employeeId}
										employeeId={employeeId}
										employmentStartDate={
											employee.startDate
												? new Date(employee.startDate).toISOString().slice(0, 10)
												: null
										}
										onSaved={async () => {
											await Promise.all([
												employeeData.refetch(),
												queryClient.invalidateQueries({
													queryKey: ["employee-tracking-date", employeeId],
												}),
												queryClient.invalidateQueries({
													queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId],
												}),
											]);
										}}
									/>
									<EmployeeEmploymentHistoryCard
										history={employeeData.employmentHistory}
										canManage={isOrgAdmin}
										onCreate={employeeData.createEmploymentHistory}
										onConfirm={employeeData.confirmEmploymentHistory}
										onCancel={employeeData.cancelEmploymentHistory}
										isCreating={employeeData.isCreatingEmploymentHistory}
										isMutating={
											employeeData.isConfirmingEmploymentHistory ||
											employeeData.isCancelingEmploymentHistory
										}
										workPolicies={workPolicies}
										notice={<WageHistoryMergeNote employeeId={employeeId} />}
										lifecycleEvents={<EmploymentLifecycleEvents employeeId={employeeId} />}
										changeWage={
											employee.contractTypeToday === "hourly"
												? {
														onSubmit: employeeData.changeWage,
														isPending: employeeData.isChangingWage,
													}
												: undefined
										}
									/>
									<EmployeeRateSections employeeId={employeeId} settingsAccess={settingsAccess} />
								</>
							) : (
								<ScopedManagerPolicyCard
									employeeId={employeeId}
									organizationTimezone={organizationTimezone}
									workPolicies={workPolicies}
									onAssigned={() => void employeeData.refetch()}
								/>
							)}
							<ShortTermMonitorCard
								organizationId={employee.organizationId}
								employeeId={employeeId}
								isOrgAdmin={isOrgAdmin}
							/>
							<WorkingStudentMonitorCard
								organizationId={employee.organizationId}
								employeeId={employeeId}
								canManage={isOrgAdmin}
							/>
						</TabsContent>

						{/* Tab 3: Time & Balance */}
						<TabsContent value="time-balance" className="flex flex-col gap-4">
							{isOrgAdminOrManager && <EmployeeTrackingDateCard employeeId={employeeId} />}
							{isOrgAdminOrManager && <EmployeeWorkBalanceSection employeeId={employeeId} />}
							{isOrgAdmin && (
								<WorkBalanceRecalculationCard
									employeeName={buildAuthUserDisplayName(employee.user) || employee.id}
									isPending={employeeData.isRequestingWorkBalanceRecalculation}
									onRecalculate={handleWorkBalanceRecalculation}
									t={t}
								/>
							)}
						</TabsContent>

						{/* Tab 4: Access & Roles */}
						<TabsContent value="assignments" className="flex flex-col gap-4">
							{isOrgAdmin && availableManagers.length > 0 && (
								<ManagerAssignment
									employeeId={employeeId}
									currentManagers={employee.managers || []}
									availableManagers={availableManagers}
									onSuccess={employeeData.refetch}
								/>
							)}
							{isOrgAdmin && <EmployeeAssignedLocationsCard employeeId={employeeId} />}
							{isOrgAdmin && (
								<EmployeeCustomRolesCard
									employeeId={employeeId}
									organizationId={employee.organizationId}
									isAdmin={isOrgAdmin}
								/>
							)}
							<EmployeeSkillsCard
								employeeId={employeeId}
								organizationId={employee.organizationId}
								canManageSkills={isOrgAdminOrManager}
							/>
							<EmployeeKioskCard employeeId={employeeId} />
						</TabsContent>

						{/* Tab 5: Leaving Date & Offboarding (Org Admin only per Story 22) */}
						{isOrgAdmin && (
							<TabsContent value="offboarding" className="flex flex-col gap-4">
								<LeavingDatePanel
									organizationId={employee.organizationId}
									employeeId={employeeId}
								/>
								<EmployeeOffboardingSection
									organizationId={employee.organizationId}
									employeeId={employeeId}
									highlightedReviewId={highlightedReviewId}
									managers={availableManagers.map((manager) => ({
										id: manager.id,
										name: buildAuthUserDisplayName(manager.user) || manager.id,
									}))}
									workPolicies={workPolicies.map((policy) => ({
										id: policy.id,
										name: policy.name,
									}))}
								/>
								{/* Admin export (#1166): org admins only, never for their own record. */}
								<EmployeePersonalDataExportCard
									organizationId={employee.organizationId}
									employeeId={employeeId}
									isOwnRecord={employee.userId === currentUserId}
								/>
							</TabsContent>
						)}

						{/* Tab 6: Personnel File (server-capability gated) */}
						{personnelFile && (
							<TabsContent value="personnel-file">
								<PersonnelFilePanel capability={personnelFile} />
							</TabsContent>
						)}
					</Tabs>
				) : (
					<div className="flex flex-col gap-4">
						<EmployeeReadNotices data={employeeData} />
						<div className="grid gap-4 lg:grid-cols-3">
							<EmployeeOverviewCard employee={employee} schedule={employeeData.schedule} t={t} />
							{canEditDraftDetails && editForm}
						</div>
						<EmployeeInvitationActions employee={employee} settingsAccess={settingsAccess} />
					</div>
				)}
			</div>
		</div>
	);
}

function EmployeeDetailMissing() {
	const { t } = useTranslate();
	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<EmployeeDetailHeader t={t} />
				<NoEmployeeError
					className="w-full max-w-xl"
					feature={t("settings.employees.detailView.manageEmployees", "manage employees")}
				/>
			</div>
		</div>
	);
}

function EmployeeDetailLoadError({ data }: { data: ReturnType<typeof useEmployee> }) {
	const { t } = useTranslate();
	return (
		<div className="page-frame">
			<div className="page-measure space-y-6">
				<EmployeeDetailHeader t={t} />
				<div
					role="alert"
					className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
				>
					<p className="text-sm">
						{data.error?.message ||
							t("settings.employees.detailView.loadFailed", "Employee data could not be loaded")}
					</p>
					<Button variant="outline" onClick={() => void data.refetch()} disabled={data.isFetching}>
						{t("common.retry", "Try again")}
					</Button>
				</div>
			</div>
		</div>
	);
}

/** Same frame and geometry as the loaded page: heading, then overview and edit form. */
function EmployeeDetailLoading() {
	const { t } = useTranslate();
	return (
		<div className="page-frame">
			<output
				className="page-measure block space-y-6"
				aria-label={t("settings.employees.detailView.loadingEmployeeData", "Loading employee data")}
			>
				<div className="space-y-2" aria-hidden="true">
					<Skeleton className="h-4 w-36" />
					<Skeleton className="h-8 w-56" />
					<Skeleton className="h-5 w-72 max-w-full" />
				</div>
				<div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
					<Skeleton className="h-72 w-full" />
					<Skeleton className="h-72 w-full lg:col-span-2" />
				</div>
			</output>
		</div>
	);
}

/** What did not load beside the employee, and the work schedule still loading. */
function EmployeeReadNotices({ data }: { data: ReturnType<typeof useEmployee> }) {
	const { t } = useTranslate();
	return (
		<>
			{data.readErrors && Object.values(data.readErrors).some(Boolean) ? (
				<div role="alert" className="rounded-lg border p-4">
					<p>
						{t(
							"settings.employees.detailView.secondaryLoadFailed",
							"Some employee information could not be loaded. Your edits have been kept.",
						)}
					</p>
					<Button variant="outline" onClick={() => void data.refetch()} disabled={data.isFetching}>
						{t("common.retry", "Try again")}
					</Button>
				</div>
			) : null}
			{data.isLoadingSchedule ? (
				<p role="status">
					{t("settings.employees.detailView.loadingSchedule", "Loading work schedule…")}
				</p>
			) : null}
		</>
	);
}

function EmployeeDetailEditCard({
	form,
	employee,
	settingsAccess,
	isUpdating,
	teamOptions,
	customFields,
	onCancel,
}: {
	form: EmployeeDetailFormApi;
	employee: EmployeeDetail;
	settingsAccess: SettingsAccess | null;
	isUpdating: boolean;
	/** Only for an org admin editing a real employee: the Team field stays hidden without. */
	teamOptions: EmployeeTeamOption[] | undefined;
	customFields: ReturnType<typeof useCustomFieldDrafts>;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const isDraft = employee.kind === "invitationDraft";

	return (
		<EmployeeEditFormCard
			form={form}
			canEditManagerFields={meetsSettingsAccess(settingsAccess, "scopedManager")}
			canEditOrgAdminFields={meetsSettingsAccess(settingsAccess, "orgAdmin")}
			personnelNumberManagedByScim={
				employee.kind === "employee" && employee.personnelNumberManagedByScim
			}
			contract={
				employee.kind === "invitationDraft"
					? { kind: "draft" }
					: {
							kind: "terms",
							contractTypeToday: employee.contractTypeToday ?? null,
						}
			}
			isUpdating={isUpdating}
			onCancel={onCancel}
			t={t}
			team={
				teamOptions
					? {
							employeeId: employee.kind === "employee" ? employee.id : undefined,
							currentTeam: employee.team
								? { id: employee.team.id, name: employee.team.name }
								: null,
							options: teamOptions,
						}
					: null
			}
			hasCustomFieldChanges={customFields.isDirty}
			customFields={
				isDraft ? null : <CustomFieldDraftsSection drafts={customFields} disabled={isUpdating} />
			}
		/>
	);
}

/** Customer billing and internal cost rates use the same feature and access gate. */
function EmployeeRateSections({
	employeeId,
	settingsAccess,
}: {
	employeeId: string;
	settingsAccess: SettingsAccess | null;
}) {
	const { t } = useTranslate();
	const billableTimeEnabled = useBillableTimeEnabled();
	if (!meetsSettingsAccess(settingsAccess, "orgAdmin") || !billableTimeEnabled) return null;

	return (
		<>
			<BillableRateSeries
				target={{ level: "employee", employeeId }}
				title={
					<>
						<IconCoin aria-hidden="true" className="size-5" />
						{t("settings.billableTime.rates.employeeRateTitle", "Billable rate")}
					</>
				}
				description={t(
					"settings.billableTime.rates.employeeRateDescription",
					"What your organization charges customers per hour of this employee's work when no project, customer or employee-on-project rate applies.",
				)}
			/>

			<CostRateSeries
				employeeId={employeeId}
				title={
					<>
						<IconReceipt2 aria-hidden="true" className="size-5" />
						{t("settings.billableTime.costRates.employeeTitle", "Cost rate")}
					</>
				}
				description={t(
					"settings.billableTime.costRates.employeeDescription",
					"This employee's fully loaded internal cost per hour, used for margin. Separate from the wage.",
				)}
			/>
		</>
	);
}

function EmployeeInvitationActions({
	employee,
	settingsAccess,
}: {
	employee: NonNullable<ReturnType<typeof useEmployee>["employee"]>;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
}) {
	const canManageDraftActions = meetsSettingsAccess(settingsAccess, "orgAdmin");
	if (employee.kind !== "invitationDraft" || !canManageDraftActions) return null;
	return (
		<EmployeeDraftActions
			organizationId={employee.organizationId}
			encodedDraftEmployeeId={employee.encodedId}
			invitationId={employee.invitation.id}
			invitationStatus={employee.invitationStatus}
		/>
	);
}
