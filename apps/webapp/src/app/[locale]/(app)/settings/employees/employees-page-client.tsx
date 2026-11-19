"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconPlus,
	IconRefresh,
	IconUser,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { flexRender, type SortingState, useTable } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useMemo, useState, useTransition } from "react";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { InviteCodeManagement } from "@/components/organization/invite-code-management";
import { InviteMemberDialog } from "@/components/organization/invite-member-dialog";
import { MembersTable } from "@/components/organization/members-table";
import { PendingMembersCard } from "@/components/organization/pending-members-card";
import type {
	InvitationWithInviter,
	MemberWithUserAndEmployee,
} from "@/components/organization/people-management-types";
import { EmploymentDateUploadDialog } from "@/components/settings/employment-date-upload-dialog";
import { OpeningBalanceUploadDialog } from "@/components/settings/work-balance/opening-balance-upload-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/hooks/use-organization";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { queryKeys, useEmployeeClockStatuses } from "@/lib/query";
import { useEmployees } from "@/lib/query/use-employees";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { useRouter } from "@/navigation";
import { createEmployeeColumns } from "./columns";
import {
	type EmployeeDirectoryStatus,
	type EmployeeWithRelations,
	normalizeEmployeeDirectoryStatus,
	type PaginatedEmployeeResponse,
} from "./employee-action-types";
import { employeeTableFeatures } from "./employee-table-features";

export interface EmployeesPagePeopleProps {
	organizationName: string;
	organizationToday: string;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentUserId: string;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
}

interface EmployeeAdministrationProps {
	accessTier: SettingsAccessTier;
	organizationId: string;
	currentUserId: string;
	currentEmployee: { id: string; role: "admin" | "manager" | "employee" } | null;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
	people?: EmployeesPagePeopleProps;
}

export function EmployeesPageClient(props: EmployeeAdministrationProps) {
	const organization = useOrganization();
	const router = useRouter();
	const { t } = useTranslate();
	const [pending, startRetry] = useTransition();
	const current =
		!organization.error &&
		organization.userId === props.currentUserId &&
		organization.activeOrganizationId === props.organizationId &&
		organization.employeeId === (props.currentEmployee?.id ?? null) &&
		organization.role === (props.currentEmployee?.role ?? null);
	if (!current) {
		return (
			<div className="flex min-w-0 flex-col gap-6 p-4 lg:p-6">
				<PageHeader title={t("settings.employees.title", "Employees")} />
				{organization.isLoading ? (
					<p role="status">{t("common.loading", "Loading...")}</p>
				) : (
					<div role="alert" className="space-y-3 rounded-lg border p-4">
						<p>
							{t(
								"settings.employees.scopeChanged",
								"Employee context is unavailable or changed. Refresh to continue.",
							)}
						</p>
						<Button
							disabled={pending}
							onClick={() =>
								startRetry(async () => {
									await organization.refetch();
									router.refresh();
								})
							}
						>
							{t("common.retry", "Try again")}
						</Button>
					</div>
				)}
			</div>
		);
	}
	return (
		<EmployeeAdministration
			key={JSON.stringify([
				props.currentUserId,
				props.organizationId,
				organization.employeeId,
				organization.role,
				props.settingsAccess,
			])}
			{...props}
		/>
	);
}

function EmployeeAdministration(props: EmployeeAdministrationProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
	const [isRefreshingPeople, startPeopleRefresh] = useTransition();

	const people = props.people;
	const shouldShowPeopleTabs = meetsSettingsAccess(props.settingsAccess, "orgAdmin") && people;

	const handlePeopleRefresh = () => {
		startPeopleRefresh(async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.members.list(props.organizationId) }),
				queryClient.invalidateQueries({
					queryKey: queryKeys.invitations.list(props.organizationId),
				}),
			]);
			router.refresh();
		});
	};

	return (
		<div
			data-testid="employees-content"
			className="mx-auto flex w-full min-w-0 max-w-(--breakpoint-2xl) flex-1 flex-col gap-6 p-4 lg:p-6"
		>
			<PageHeader
				title={t("settings.employees.title", "Employees")}
				description={t("settings.employees.description", "Manage employees, members, and invites")}
				scope={people?.organizationName}
				actions={
					shouldShowPeopleTabs ? (
						<>
							<EmploymentDateUploadDialog />
							<OpeningBalanceUploadDialog />
							<Button onClick={() => setInviteDialogOpen(true)}>
								<IconPlus className="size-4" aria-hidden="true" />
								{t("organization.invite.title", "Invite Member")}
							</Button>
						</>
					) : undefined
				}
			/>
			{!shouldShowPeopleTabs ? (
				<EmployeeDirectoryTab {...props} />
			) : (
				<>
					<Tabs defaultValue="employees" className="space-y-4">
						<TabsList className="h-auto w-full flex-wrap justify-start gap-1 p-1 sm:w-fit">
							<TabsTrigger value="employees">
								{t("settings.employees.tabs.employees", "Employees")}
							</TabsTrigger>
							<TabsTrigger value="members">
								{t("settings.employees.tabs.members", "Members")}
							</TabsTrigger>
							<TabsTrigger value="invitations">
								{t("settings.employees.tabs.invitations", "Invitations")}
							</TabsTrigger>
							<TabsTrigger value="invite-codes">
								{t("settings.employees.tabs.inviteCodes", "Invite Codes")}
							</TabsTrigger>
						</TabsList>

						<TabsContent value="employees" className="space-y-4" keepMounted>
							<EmployeeDirectoryTab
								accessTier={props.accessTier}
								organizationId={props.organizationId}
								currentUserId={props.currentUserId}
								settingsAccess={props.settingsAccess}
							/>
						</TabsContent>

						<TabsContent value="members" className="space-y-4" keepMounted>
							<MembersTable
								organizationId={props.organizationId}
								members={people.members}
								invitations={[]}
								settingsAccess={props.settingsAccess}
								currentUserId={people.currentUserId}
								onRefresh={handlePeopleRefresh}
								isRefreshing={isRefreshingPeople}
							/>
						</TabsContent>

						<TabsContent value="invitations" className="space-y-4" keepMounted>
							<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
								<div>
									<h2 className="text-lg font-semibold">
										{t("settings.employees.invitations.title", "Invitations")}
									</h2>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.employees.invitations.description",
											"Invite members and review pending join requests",
										)}
									</p>
								</div>
								<Button onClick={() => setInviteDialogOpen(true)}>
									<IconPlus className="mr-2 size-4" aria-hidden="true" />
									{t("organization.invite.title", "Invite Member")}
								</Button>
							</div>

							<MembersTable
								organizationId={props.organizationId}
								members={[]}
								invitations={people.invitations}
								defaultTab="invitations"
								settingsAccess={props.settingsAccess}
								currentUserId={people.currentUserId}
								onRefresh={handlePeopleRefresh}
								isRefreshing={isRefreshingPeople}
							/>
							<PendingMembersCard
								organizationId={props.organizationId}
								settingsAccess={props.settingsAccess}
							/>
						</TabsContent>

						<TabsContent value="invite-codes" className="space-y-4" keepMounted>
							<InviteCodeManagement
								organizationId={props.organizationId}
								organizationToday={people.organizationToday}
								settingsAccess={props.settingsAccess}
							/>
						</TabsContent>
					</Tabs>

					<InviteMemberDialog
						organizationId={props.organizationId}
						organizationName={people.organizationName}
						settingsAccess={props.settingsAccess}
						open={inviteDialogOpen}
						onOpenChange={setInviteDialogOpen}
					/>
				</>
			)}
		</div>
	);
}

function EmployeeDirectoryFilters({
	searchInput,
	onSearchInputChange,
	role,
	onRoleChange,
	status,
	onStatusChange,
}: {
	searchInput: string;
	onSearchInputChange(value: string): void;
	role: string;
	onRoleChange(value: string): void;
	status: EmployeeDirectoryStatus;
	onStatusChange(value: EmployeeDirectoryStatus): void;
}) {
	const { t } = useTranslate();

	return (
		<DataTableToolbar
			search={searchInput}
			onSearchChange={onSearchInputChange}
			searchLabel={t("settings.employees.directory.searchLabel", "Search employees")}
			searchPlaceholder={t(
				"settings.employees.directory.searchPlaceholder",
				"Search by name, email, or position...",
			)}
			filters={[
				{
					key: "role",
					label: t("settings.employees.directory.roleFilter", "Filter by role"),
					options: [
						{ value: "all", label: t("settings.employees.directory.roles.all", "All Roles") },
						{ value: "admin", label: t("settings.employees.directory.roles.admin", "Admin") },
						{ value: "manager", label: t("settings.employees.directory.roles.manager", "Manager") },
						{
							value: "employee",
							label: t("settings.employees.directory.roles.employee", "Employee"),
						},
					],
				},
				{
					key: "status",
					label: t("settings.employees.directory.statusFilter", "Filter by status"),
					defaultValue: "current",
					options: [
						{
							value: "current",
							label: t("settings.employees.directory.statuses.current", "Current"),
						},
						{ value: "former", label: t("settings.employees.directory.statuses.former", "Former") },
						{ value: "draft", label: t("settings.employees.directory.statuses.draft", "Draft") },
						{ value: "all", label: t("settings.employees.directory.statuses.all", "All Status") },
					],
				},
			]}
			filterValues={{ role, status }}
			onFilterChange={(key, value) =>
				key === "role"
					? onRoleChange(value)
					: onStatusChange(normalizeEmployeeDirectoryStatus(value, "current"))
			}
		/>
	);
}

function EmployeeDirectoryTab(props: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	currentUserId: string;
	settingsAccess: SettingsAccess | null;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const {
		employees,
		total,
		isLoading,
		isFetching,
		isError,
		error,
		hasEmployee,
		role,
		status,
		setSearch,
		setRole,
		setStatus,
		pagination,
		setPagination,
		pageCount,
		refresh,
	} = useEmployees({
		accessTier: props.accessTier,
		organizationId: props.organizationId,
	});
	const presence = useEmployeeClockStatuses(
		employees.map((employee) => employee.id),
		{ polling: true },
	);
	const employeesWithPresence = useMemo(
		() =>
			employees.map((employee) => ({
				...employee,
				clockStatus: presence.snapshots[employee.id.trim()]?.status ?? "unknown",
			})),
		[employees, presence.snapshots],
	);

	const [sorting, setSorting] = useState<SortingState>([]);
	const [searchInput, setSearchInput] = useState("");
	const updateCachedEmployee = (
		employeeId: string,
		updates: Pick<EmployeeWithRelations, "isActive" | "isFormer"> &
			Partial<Pick<EmployeeWithRelations, "membership">>,
	) => {
		queryClient.setQueriesData<PaginatedEmployeeResponse>(
			{ queryKey: queryKeys.employees.organization(props.organizationId) },
			(current) =>
				current
					? {
							...current,
							employees: current.employees.map((row) =>
								row.kind === "employee" && row.id === employeeId ? { ...row, ...updates } : row,
							),
						}
					: current,
		);
	};
	const columns = createEmployeeColumns({
		organizationId: props.organizationId,
		currentUserId: props.currentUserId,
		settingsAccess: props.settingsAccess,
		// Deactivating makes a former employee at once; reactivating brings them back (#1438).
		onOptimisticStatusChange: (employeeId, isActive) =>
			updateCachedEmployee(employeeId, { isActive, isFormer: !isActive }),
		onRemoved: (employeeId) =>
			updateCachedEmployee(employeeId, {
				isActive: false,
				isFormer: true,
				membership: null,
			}),
	});

	const commitSearch = useEffectEvent(setSearch);
	useEffect(() => {
		const timer = setTimeout(() => {
			commitSearch(searchInput);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput]);

	const table = useTable({
		features: employeeTableFeatures,
		data: employeesWithPresence,
		columns,
		state: { sorting, pagination },
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		manualPagination: true,
		pageCount,
	});

	if (!hasEmployee && !isLoading && !isError) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("settings.employees.directory.noEmployeeFeature", "manage employees")}
				/>
			</div>
		);
	}

	return (
		<Card>
			<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<CardTitle>{t("settings.employees.directory.title", "Employee Directory")}</CardTitle>
					<CardDescription aria-live="polite">
						{!isError &&
							!isLoading &&
							t("settings.employees.directory.countFound", "{count} employee(s) found", {
								count: total,
							})}
					</CardDescription>
				</div>
				{
					<Button variant="ghost" size="icon" onClick={refresh} disabled={isFetching}>
						<IconRefresh
							aria-hidden="true"
							className={`size-4 ${isFetching ? "motion-safe:animate-spin" : ""}`}
						/>
						<span className="sr-only">{t("settings.employees.directory.refresh", "Refresh")}</span>
					</Button>
				}
			</CardHeader>
			<CardContent className="space-y-4">
				<EmployeeDirectoryFilters
					searchInput={searchInput}
					onSearchInputChange={setSearchInput}
					role={role}
					onRoleChange={setRole}
					status={status}
					onStatusChange={setStatus}
				/>

				{isError ? (
					<div
						role="alert"
						className="space-y-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4"
					>
						<p>
							{error?.message ||
								t(
									"settings.employees.directory.loadFailed",
									"Employee directory could not be loaded",
								)}
						</p>
						<Button variant="outline" onClick={() => void refresh()} disabled={isFetching}>
							{t("common.retry", "Try again")}
						</Button>
					</div>
				) : isLoading ? (
					<div className="flex items-center justify-center py-8">
						<p className="text-sm text-muted-foreground">
							{t("settings.employees.directory.loading", "Loading employees...")}
						</p>
					</div>
				) : (
					<>
						<div className="overflow-x-auto rounded-md border">
							<Table mobileLayout="stacked">
								<TableHeader>
									{table.getHeaderGroups().map((headerGroup) => (
										<TableRow key={headerGroup.id}>
											{headerGroup.headers.map((header) => (
												<TableHead key={header.id}>
													{header.isPlaceholder
														? null
														: flexRender(header.column.columnDef.header, header.getContext())}
												</TableHead>
											))}
										</TableRow>
									))}
								</TableHeader>
								<TableBody>
									{table.getRowModel().rows.length ? (
										table.getRowModel().rows.map((row) => (
											<TableRow key={row.id}>
												{row.getVisibleCells().map((cell) => (
													<TableCell key={cell.id} className="whitespace-normal break-words">
														{flexRender(cell.column.columnDef.cell, cell.getContext())}
													</TableCell>
												))}
											</TableRow>
										))
									) : (
										<TableRow>
											<TableCell colSpan={columns.length} className="h-24 text-center">
												<div className="flex flex-col items-center justify-center">
													<IconUser className="mb-2 size-8 text-muted-foreground" />
													<p className="text-sm text-muted-foreground">
														{t("settings.employees.directory.emptyState", "No employees found")}
													</p>
												</div>
											</TableCell>
										</TableRow>
									)}
								</TableBody>
							</Table>
						</div>

						{pageCount > 1 && (
							<div className="mt-4 flex flex-wrap items-center justify-between gap-3">
								<div className="text-sm text-muted-foreground">
									{t("settings.employees.directory.pagination.pageOf", "Page {page} of {total}", {
										page: table.state.pagination.pageIndex + 1,
										total: table.getPageCount(),
									})}
								</div>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										onClick={() => table.previousPage()}
										disabled={!table.getCanPreviousPage() || isFetching}
									>
										<IconChevronLeft className="mr-1 size-4" />
										{t("settings.employees.directory.pagination.previous", "Previous")}
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={() => table.nextPage()}
										disabled={!table.getCanNextPage() || isFetching}
									>
										{t("settings.employees.directory.pagination.next", "Next")}
										<IconChevronRight className="ml-1 size-4" />
									</Button>
								</div>
							</div>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}
