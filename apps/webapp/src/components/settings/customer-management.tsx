"use client";

import {
	IconAddressBook,
	IconCoin,
	IconEdit,
	IconLoader2,
	IconPlugConnected,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	type CustomerData,
	deleteCustomer,
	getCustomers,
} from "@/app/[locale]/(app)/settings/customers/actions";
import { getProjects } from "@/app/[locale]/(app)/settings/projects/actions";
import { CustomerAccountingPanel } from "@/components/billable-time/accounting/customer-accounting-panel";
import { BillableRateActionPanel } from "@/components/billable-time/billable-rate-series";
import {
	AlertDialog,
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
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsListSkeleton } from "./settings-list-skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { queryKeys } from "@/lib/query";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";
import { MissingRequiredValuesBadge } from "./custom-fields/custom-field-values-section";
import { CustomerDialog } from "./customer-dialog";

interface CustomerManagementProps {
	organizationId: string;
	settingsAccess: SettingsAccess;
}

function useCustomerManagement({ organizationId, settingsAccess }: CustomerManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingCustomer, setEditingCustomer] = useState<CustomerData | null>(null);
	const [deletingCustomer, setDeletingCustomer] = useState<CustomerData | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [ratesCustomer, setRatesCustomer] = useState<CustomerData | null>(null);
	const [accountingCustomer, setAccountingCustomer] = useState<CustomerData | null>(null);
	const isOrgAdmin = meetsSettingsAccess(settingsAccess, "orgAdmin");
	// Billable rates are for owners and admins only (#898); the actions check again.
	const canSetBillableRates = useBillableTimeEnabled() && isOrgAdmin;

	const {
		data: customersResult,
		isLoading,
		isError,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.customers.list(organizationId),
		queryFn: async () => {
			const result = await getCustomers();
			if (!result.success) throw new Error(result.error ?? "Unknown error");
			return result.data;
		},
	});

	const customers = customersResult || [];
	const { data: scopedProjectsResult } = useQuery({
		queryKey: queryKeys.projects.list(organizationId, { scope: "customer-management" }),
		queryFn: async () => {
			const result = await getProjects();
			if (!result.success) {
				return [];
			}

			return result.data;
		},
	});
	const hasScopedProjects = (scopedProjectsResult?.length ?? 0) > 0;
	const canCreateCustomer = isOrgAdmin || hasScopedProjects;

	const handleCreate = () => {
		if (!canCreateCustomer) {
			return;
		}

		setEditingCustomer(null);
		setDialogOpen(true);
	};

	const handleEdit = (cust: CustomerData) => {
		setEditingCustomer(cust);
		setDialogOpen(true);
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.customers.list(organizationId) });
		setDialogOpen(false);
		setEditingCustomer(null);
	};

	const handleDelete = async () => {
		if (!deletingCustomer) return;
		setIsDeleting(true);
		const result = await deleteCustomer({ customerId: deletingCustomer.id }).then(
			(response) => response,
			() => null,
		);
		if (!result) {
			toast.error(t("settings.customers.deleteFailed", "Failed to delete customer"));
			setIsDeleting(false);
			setDeletingCustomer(null);
			return;
		}

		if (result.success) {
			toast.success(t("settings.customers.deleted", "Customer deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.customers.list(organizationId) });
		} else {
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.customers.deleteFailed",
					"Failed to delete customer",
				]),
			);
		}

		setIsDeleting(false);
		setDeletingCustomer(null);
	};

	return {
		t,
		refetch,
		isFetching,
		handleCreate,
		canCreateCustomer,
		isLoading,
		// A failed background refetch keeps the loaded list; only a failed first load shows the error.
		isError: isError && !customersResult,
		customers,
		handleEdit,
		canSetBillableRates,
		setRatesCustomer,
		setAccountingCustomer,
		setDeletingCustomer,
		ratesCustomer,
		accountingCustomer,
		organizationId,
		editingCustomer,
		dialogOpen,
		setDialogOpen,
		handleSuccess,
		deletingCustomer,
		isDeleting,
		handleDelete,
	};
}

export function CustomerManagement({ organizationId, settingsAccess }: CustomerManagementProps) {
	const {
		t,
		refetch,
		isFetching,
		handleCreate,
		canCreateCustomer,
		isLoading,
		isError,
		customers,
		handleEdit,
		canSetBillableRates,
		setRatesCustomer,
		setAccountingCustomer,
		setDeletingCustomer,
		ratesCustomer,
		accountingCustomer,
		editingCustomer,
		dialogOpen,
		setDialogOpen,
		handleSuccess,
		deletingCustomer,
		isDeleting,
		handleDelete,
	} = useCustomerManagement({ organizationId, settingsAccess });
	return (
		<div className="page-frame flex flex-1 flex-col gap-6">
			<PageHeader
				title={t("settings.customers.title", "Customers")}
				description={t(
					"settings.customers.description",
					"Manage customer contacts for project assignments",
				)}
				actions={
					<>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => refetch()}
							disabled={isFetching}
							aria-label={t("common.refresh", "Refresh")}
						>
							<IconRefresh
								aria-hidden="true"
								className={`size-4 ${isFetching ? "animate-spin" : ""}`}
							/>
						</Button>
						<Button onClick={handleCreate} disabled={!canCreateCustomer}>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t("settings.customers.create", "Add Customer")}
						</Button>
					</>
				}
			/>
			{/* The empty state repeats this hint beside its own add button. */}
			{!canCreateCustomer && (isLoading || isError || customers.length > 0) ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.customers.managerNoProjects",
						"No managed projects available. Create or manage a project before adding customers.",
					)}
				</p>
			) : null}

			{isLoading ? (
				<SettingsListSkeleton />
			) : isError ? (
				<Card>
					<CardContent className="flex flex-col items-start gap-3">
						<p className="text-sm text-destructive" role="alert">
							{t(
								"settings.customers.loadFailed",
								"Customers could not be loaded. Check your connection and try again.",
							)}
						</p>
						<Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
							<IconRefresh aria-hidden="true" className="mr-2 size-4" />
							{t("common.retry", "Retry")}
						</Button>
					</CardContent>
				</Card>
			) : customers.length === 0 ? (
				<CustomersEmptyState canCreateCustomer={canCreateCustomer} handleCreate={handleCreate} />
			) : (
				<CustomerTableCard
					t={t}
					customers={customers}
					handleEdit={handleEdit}
					canSetBillableRates={canSetBillableRates}
					setRatesCustomer={setRatesCustomer}
					setAccountingCustomer={setAccountingCustomer}
					setDeletingCustomer={setDeletingCustomer}
				/>
			)}

			{canSetBillableRates && (
				<CustomerRatePanel ratesCustomer={ratesCustomer} setRatesCustomer={setRatesCustomer} />
			)}

			{canSetBillableRates && (
				<CustomerAccountingPanel
					open={accountingCustomer !== null}
					onOpenChange={(open) => {
						if (!open) setAccountingCustomer(null);
					}}
					customerId={accountingCustomer?.id ?? null}
					customerName={accountingCustomer?.name ?? ""}
				/>
			)}

			<CustomerDialog
				settingsAccess={settingsAccess}
				organizationId={organizationId}
				customer={editingCustomer}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={handleSuccess}
			/>

			<DeleteCustomerDialog
				deletingCustomer={deletingCustomer}
				isDeleting={isDeleting}
				setDeletingCustomer={setDeletingCustomer}
				handleDelete={handleDelete}
			/>
		</div>
	);
}

function CustomerTableCard({
	t,
	customers,
	handleEdit,
	canSetBillableRates,
	setRatesCustomer,
	setAccountingCustomer,
	setDeletingCustomer,
}: Pick<
	ReturnType<typeof useCustomerManagement>,
	| "t"
	| "customers"
	| "handleEdit"
	| "canSetBillableRates"
	| "setRatesCustomer"
	| "setAccountingCustomer"
	| "setDeletingCustomer"
>) {
	return (
		<Card>
			<CardHeader>
				<CardTitle role="heading" aria-level={2}>
					{t("settings.customers.list.title", "All Customers")}
				</CardTitle>
				<CardDescription>
					{t("settings.customers.list.description", "{count} customers total", {
						count: customers.length,
					})}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("settings.customers.column.name", "Company Name")}</TableHead>
							<TableHead>
								{t("settings.customers.column.contactPerson", "Contact Person")}
							</TableHead>
							<TableHead>{t("settings.customers.column.email", "Email")}</TableHead>
							<TableHead>{t("settings.customers.column.phone", "Phone")}</TableHead>
							<TableHead className="w-[100px]">
								<span className="sr-only">{t("settings.customers.column.actions", "Actions")}</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{customers.map((cust) => (
							<TableRow key={cust.id}>
								<TableCell className="max-w-xs">
									<div className="truncate font-medium" title={cust.name}>
										{cust.name}
									</div>
									{cust.missingRequiredCustomFields && (
										<MissingRequiredValuesBadge className="mt-1" />
									)}
									{cust.address && (
										<div className="text-sm text-muted-foreground line-clamp-1">{cust.address}</div>
									)}
								</TableCell>
								<TableCell>
									{cust.contactPerson || <span className="text-muted-foreground">-</span>}
								</TableCell>
								<TableCell>
									{cust.email ? (
										<a
											href={`mailto:${cust.email}`}
											className="text-sm text-primary hover:underline"
										>
											{cust.email}
										</a>
									) : (
										<span className="text-muted-foreground">-</span>
									)}
								</TableCell>
								<TableCell>
									{cust.phone || <span className="text-muted-foreground">-</span>}
								</TableCell>
								<TableCell>
									<div className="flex flex-wrap items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleEdit(cust)}
											aria-label={t("settings.customers.editAction", "Edit {name}", {
												name: cust.name,
											})}
											title={t("settings.customers.edit", "Edit customer")}
										>
											<IconEdit aria-hidden="true" className="size-4" />
										</Button>
										{canSetBillableRates && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setRatesCustomer(cust)}
												aria-label={t(
													"settings.billableTime.rates.customerRateTitle",
													"Billable rate for {name}",
													{ name: cust.name },
												)}
												title={t("settings.billableTime.rates.customerRate", "Billable rate")}
											>
												<IconCoin aria-hidden="true" className="size-4" />
											</Button>
										)}
										{canSetBillableRates && (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => setAccountingCustomer(cust)}
												aria-label={t(
													"settings.customers.accountingAction",
													"Accounting for {name}",
													{ name: cust.name },
												)}
												title={t("settings.billableTime.accounting.customer.entry", "Accounting")}
											>
												<IconPlugConnected aria-hidden="true" className="size-4" />
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setDeletingCustomer(cust)}
											aria-label={t("settings.customers.deleteAction", "Delete {name}", {
												name: cust.name,
											})}
											title={t("settings.customers.delete.title", "Delete Customer")}
										>
											<IconTrash aria-hidden="true" className="size-4 text-destructive" />
										</Button>
									</div>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function CustomersEmptyState({
	canCreateCustomer,
	handleCreate,
}: {
	canCreateCustomer: boolean;
	handleCreate: () => void;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardContent>
				<Empty>
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconAddressBook aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle role="heading" aria-level={2}>
							{t("settings.customers.empty.title", "No customers yet")}
						</EmptyTitle>
						<EmptyDescription>
							{t(
								"settings.customers.empty.description",
								"Add your first customer to assign them to projects.",
							)}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button onClick={handleCreate} disabled={!canCreateCustomer}>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t("settings.customers.create", "Add Customer")}
						</Button>
						{!canCreateCustomer ? (
							<p className="text-center text-sm text-muted-foreground">
								{t(
									"settings.customers.managerNoProjects",
									"No managed projects available. Create or manage a project before adding customers.",
								)}
							</p>
						) : null}
					</EmptyContent>
				</Empty>
			</CardContent>
		</Card>
	);
}

function DeleteCustomerDialog({
	deletingCustomer,
	isDeleting,
	setDeletingCustomer,
	handleDelete,
}: {
	deletingCustomer: CustomerData | null;
	isDeleting: boolean;
	setDeletingCustomer: (value: null) => void;
	handleDelete: () => void;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog
			open={!!deletingCustomer}
			onOpenChange={(open) => {
				// Stay open while the delete runs, so its outcome belongs to this customer.
				if (!open && !isDeleting) setDeletingCustomer(null);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("settings.customers.delete.title", "Delete Customer")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.customers.delete.description",
							'Are you sure you want to delete "{name}"? Projects assigned to this customer will keep working but the customer reference will be removed.',
							{
								name: deletingCustomer?.name ?? "",
							},
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isDeleting}>
						{t("common.cancel", "Cancel")}
					</AlertDialogCancel>
					{/* A plain button keeps the dialog open, showing progress until the delete settles. */}
					<Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
						{isDeleting && <IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />}
						{t("settings.customers.delete.confirm", "Delete {name}", {
							name: deletingCustomer?.name ?? "",
						})}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function CustomerRatePanel({
	ratesCustomer,
	setRatesCustomer,
}: {
	ratesCustomer: CustomerData | null;
	setRatesCustomer: (value: null) => void;
}) {
	const { t } = useTranslate();
	return (
		<BillableRateActionPanel
			open={ratesCustomer !== null}
			onOpenChange={(open) => {
				if (!open) setRatesCustomer(null);
			}}
			target={ratesCustomer ? { level: "customer", customerId: ratesCustomer.id } : null}
			title={t("settings.billableTime.rates.customerRateTitle", "Billable rate for {name}", {
				name: ratesCustomer?.name ?? "",
			})}
			description={t(
				"settings.billableTime.rates.level.customerDescription",
				"Applies to work on the customer's projects without a project rate.",
			)}
		/>
	);
}
