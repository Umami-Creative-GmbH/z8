"use client";

import {
	IconChevronLeft,
	IconChevronRight,
	IconPlus,
	IconRefresh,
	IconSearch,
	IconUser,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
	flexRender,
	getCoreRowModel,
	getSortedRowModel,
	type SortingState,
} from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState, useTransition } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { InviteCodeManagement } from "@/components/organization/invite-code-management";
import { InviteMemberDialog } from "@/components/organization/invite-member-dialog";
import { MembersTable } from "@/components/organization/members-table";
import { PendingMembersCard } from "@/components/organization/pending-members-card";
import type {
	InvitationWithInviter,
	MemberWithUserAndEmployee,
} from "@/components/organization/people-management-types";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompilerSafeReactTable } from "@/components/use-compiler-safe-react-table";
import { queryKeys, useEmployeeClockStatuses } from "@/lib/query";
import { useEmployees } from "@/lib/query/use-employees";
import type { SettingsAccessTier } from "@/lib/settings-access";
import { createEmployeeColumns } from "./columns";
import type {
	EmployeeDirectoryRow,
	EmployeeDirectoryStatus,
	PaginatedEmployeeResponse,
} from "./employee-action-types";

export interface EmployeesPagePeopleProps {
	organizationName: string;
	organizationToday: string;
	members: MemberWithUserAndEmployee[];
	invitations: InvitationWithInviter[];
	currentMemberRole: "owner" | "admin" | "member";
	currentUserId: string;
}

export function EmployeesPageClient(props: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	currentUserId: string;
	currentMemberRole: string;
	people?: EmployeesPagePeopleProps;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
	const [isRefreshingPeople, startPeopleRefresh] = useTransition();

	const people = props.people;
	const shouldShowPeopleTabs = props.accessTier === "orgAdmin" && people;

	if (!shouldShowPeopleTabs) {
		return (
			<div className="flex flex-1 flex-col gap-4 p-4">
				<EmployeeDirectoryTab
					accessTier={props.accessTier}
					organizationId={props.organizationId}
					currentUserId={props.currentUserId}
					currentMemberRole={props.currentMemberRole}
					showHeader
				/>
			</div>
		);
	}

	const handlePeopleRefresh = () => {
		startPeopleRefresh(() => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.members.list(props.organizationId),
			});
			queryClient.invalidateQueries({
				queryKey: queryKeys.invitations.list(props.organizationId),
			});
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.employees.title", "Employees")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.employees.description",
						"Manage employees, members, and invites",
					)}
				</p>
			</div>

			<Tabs defaultValue="employees" className="space-y-4">
				<TabsList className="flex h-auto flex-wrap justify-start">
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

				<TabsContent value="employees" className="space-y-4">
					<EmployeeDirectoryTab
						accessTier={props.accessTier}
						organizationId={props.organizationId}
						currentUserId={props.currentUserId}
						currentMemberRole={props.currentMemberRole}
						showHeader={false}
					/>
				</TabsContent>

				<TabsContent value="members" className="space-y-4">
					<MembersTable
						organizationId={props.organizationId}
						members={people.members}
						invitations={[]}
						currentMemberRole={people.currentMemberRole}
						currentUserId={people.currentUserId}
						onRefresh={handlePeopleRefresh}
						isRefreshing={isRefreshingPeople}
					/>
				</TabsContent>

				<TabsContent value="invitations" className="space-y-4">
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
							<IconPlus className="mr-2 size-4" />
							{t("organization.invite.title", "Invite Member")}
						</Button>
					</div>

					<MembersTable
						organizationId={props.organizationId}
						members={[]}
						invitations={people.invitations}
						defaultTab="invitations"
						currentMemberRole={people.currentMemberRole}
						currentUserId={people.currentUserId}
						onRefresh={handlePeopleRefresh}
						isRefreshing={isRefreshingPeople}
					/>
					<PendingMembersCard
						organizationId={props.organizationId}
						currentMemberRole={people.currentMemberRole}
					/>
				</TabsContent>

				<TabsContent value="invite-codes" className="space-y-4">
					<InviteCodeManagement
						organizationId={props.organizationId}
						organizationToday={people.organizationToday}
						currentMemberRole={people.currentMemberRole}
					/>
				</TabsContent>
			</Tabs>

			<InviteMemberDialog
				organizationId={props.organizationId}
				organizationName={people.organizationName}
				currentMemberRole={people.currentMemberRole}
				open={inviteDialogOpen}
				onOpenChange={setInviteDialogOpen}
			/>
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
		<div className="mb-4 flex flex-col gap-4 sm:flex-row">
			<div className="relative flex-1">
				<IconSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					aria-label={t(
						"settings.employees.directory.searchLabel",
						"Search employees",
					)}
					placeholder={t(
						"settings.employees.directory.searchPlaceholder",
						"Search by name, email, or position...",
					)}
					value={searchInput}
					onChange={(event) => onSearchInputChange(event.target.value)}
					className="pl-9"
				/>
			</div>
			<Select value={role} onValueChange={onRoleChange}>
				<SelectTrigger className="w-full sm:w-[180px]">
					<SelectValue
						placeholder={t(
							"settings.employees.directory.roleFilter",
							"Filter by role",
						)}
					/>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">
						{t("settings.employees.directory.roles.all", "All Roles")}
					</SelectItem>
					<SelectItem value="admin">
						{t("settings.employees.directory.roles.admin", "Admin")}
					</SelectItem>
					<SelectItem value="manager">
						{t("settings.employees.directory.roles.manager", "Manager")}
					</SelectItem>
					<SelectItem value="employee">
						{t("settings.employees.directory.roles.employee", "Employee")}
					</SelectItem>
				</SelectContent>
			</Select>
			<Select value={status} onValueChange={onStatusChange}>
				<SelectTrigger className="w-full sm:w-[180px]">
					<SelectValue
						placeholder={t(
							"settings.employees.directory.statusFilter",
							"Filter by status",
						)}
					/>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">
						{t("settings.employees.directory.statuses.all", "All Status")}
					</SelectItem>
					<SelectItem value="active">
						{t("settings.employees.directory.statuses.active", "Active")}
					</SelectItem>
					<SelectItem value="inactive">
						{t("settings.employees.directory.statuses.inactive", "Inactive")}
					</SelectItem>
					<SelectItem value="draft">
						{t("settings.employees.directory.statuses.draft", "Draft")}
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function EmployeeDirectoryTab(props: {
	accessTier: SettingsAccessTier;
	organizationId: string;
	currentUserId: string;
	currentMemberRole: string;
	showHeader: boolean;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const {
		employees,
		total,
		isLoading,
		isFetching,
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
	const employeesWithPresence = employees.map((employee) => ({
		...employee,
		clockStatus: presence.getStatus(employee.id),
	}));

	const [sorting, setSorting] = useState<SortingState>([]);
	const [searchInput, setSearchInput] = useState("");
	const updateCachedEmployee = (
		employeeId: string,
		updates:
			| Pick<EmployeeDirectoryRow, "isActive" | "membership">
			| Pick<EmployeeDirectoryRow, "isActive">,
	) => {
		queryClient.setQueriesData<PaginatedEmployeeResponse>(
			{ queryKey: queryKeys.employees.organization(props.organizationId) },
			(current) =>
				current
					? {
							...current,
							employees: current.employees.map((row) =>
								row.kind === "employee" && row.id === employeeId
									? { ...row, ...updates }
									: row,
							),
						}
					: current,
		);
	};
	const columns = createEmployeeColumns({
		organizationId: props.organizationId,
		currentUserId: props.currentUserId,
		currentMemberRole: props.currentMemberRole,
		onOptimisticStatusChange: (employeeId, isActive) =>
			updateCachedEmployee(employeeId, { isActive }),
		onRemoved: (employeeId) =>
			updateCachedEmployee(employeeId, { isActive: false, membership: null }),
	});

	useEffect(() => {
		const timer = setTimeout(() => {
			setSearch(searchInput);
		}, 300);
		return () => clearTimeout(timer);
	}, [searchInput, setSearch]);

	const table = useCompilerSafeReactTable<EmployeeDirectoryRow>({
		data: employeesWithPresence,
		columns,
		state: { sorting, pagination },
		onSortingChange: setSorting,
		onPaginationChange: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		manualPagination: true,
		pageCount,
		manualFiltering: true,
	});

	if (!hasEmployee && !isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t(
						"settings.employees.directory.noEmployeeFeature",
						"manage employees",
					)}
				/>
			</div>
		);
	}

	return (
		<>
			{props.showHeader && (
				<div className="flex items-center justify-between">
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							{t("settings.employees.title", "Employees")}
						</h1>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.employees.description",
								"Manage employees, members, and invites",
							)}
						</p>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={refresh}
						disabled={isFetching}
					>
						<IconRefresh
							className={`size-4 ${isFetching ? "animate-spin" : ""}`}
						/>
						<span className="sr-only">
							{t("settings.employees.directory.refresh", "Refresh")}
						</span>
					</Button>
				</div>
			)}

			<Card>
				<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<CardTitle>
							{t("settings.employees.directory.title", "Employee Directory")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.employees.directory.countFound",
								"{count} employee(s) found",
								{
									count: total,
								},
							)}
						</CardDescription>
					</div>
					{!props.showHeader && (
						<Button
							variant="ghost"
							size="icon"
							onClick={refresh}
							disabled={isFetching}
						>
							<IconRefresh
								className={`size-4 ${isFetching ? "animate-spin" : ""}`}
							/>
							<span className="sr-only">
								{t("settings.employees.directory.refresh", "Refresh")}
							</span>
						</Button>
					)}
				</CardHeader>
				<CardContent>
					<EmployeeDirectoryFilters
						searchInput={searchInput}
						onSearchInputChange={setSearchInput}
						role={role}
						onRoleChange={setRole}
						status={status}
						onStatusChange={setStatus}
					/>

					{isLoading ? (
						<div className="flex items-center justify-center py-8">
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.employees.directory.loading",
									"Loading employees...",
								)}
							</p>
						</div>
					) : (
						<>
							<div className="overflow-x-auto rounded-md border">
								<Table>
									<TableHeader>
										{table.getHeaderGroups().map((headerGroup) => (
											<TableRow key={headerGroup.id}>
												{headerGroup.headers.map((header) => (
													<TableHead key={header.id}>
														{header.isPlaceholder
															? null
															: flexRender(
																	header.column.columnDef.header,
																	header.getContext(),
																)}
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
														<TableCell key={cell.id}>
															{flexRender(
																cell.column.columnDef.cell,
																cell.getContext(),
															)}
														</TableCell>
													))}
												</TableRow>
											))
										) : (
											<TableRow>
												<TableCell
													colSpan={columns.length}
													className="h-24 text-center"
												>
													<div className="flex flex-col items-center justify-center">
														<IconUser className="mb-2 size-8 text-muted-foreground" />
														<p className="text-sm text-muted-foreground">
															{t(
																"settings.employees.directory.emptyState",
																"No employees found",
															)}
														</p>
													</div>
												</TableCell>
											</TableRow>
										)}
									</TableBody>
								</Table>
							</div>

							{pageCount > 1 && (
								<div className="mt-4 flex items-center justify-between">
									<div className="text-sm text-muted-foreground">
										{t(
											"settings.employees.directory.pagination.pageOf",
											"Page {page} of {total}",
											{
												page: table.getState().pagination.pageIndex + 1,
												total: table.getPageCount(),
											},
										)}
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											onClick={() => table.previousPage()}
											disabled={!table.getCanPreviousPage() || isFetching}
										>
											<IconChevronLeft className="mr-1 size-4" />
											{t(
												"settings.employees.directory.pagination.previous",
												"Previous",
											)}
										</Button>
										<Button
											variant="outline"
											size="sm"
											onClick={() => table.nextPage()}
											disabled={!table.getCanNextPage() || isFetching}
										>
											{t(
												"settings.employees.directory.pagination.next",
												"Next",
											)}
											<IconChevronRight className="ml-1 size-4" />
										</Button>
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
		</>
	);
}
