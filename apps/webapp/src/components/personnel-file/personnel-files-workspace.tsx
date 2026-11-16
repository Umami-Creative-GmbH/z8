"use client";

import {
	IconClipboardList,
	IconFileStack,
	IconFirstAidKit,
	IconSettings,
	IconTrashX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useId, useTransition } from "react";
import { EmployeeDirectoryCard } from "@/components/employees/employee-directory-card";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { ManagedEmployee } from "@/lib/personnel-file/access-store";
import { Link } from "@/navigation";

export function PersonnelFilesHeading() {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("settings.personnelFiles.area.title", "Personnel Files")}
			description={t(
				"settings.personnelFiles.area.description",
				"The employees whose personnel file you manage.",
			)}
		/>
	);
}

/** A failed read is unknown, never an empty scope or a zero attention count. */
export function PersonnelFilesReadFailure({
	children,
}: {
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Alert role="alert">
			<AlertDescription className="space-y-3">
				<p>{children}</p>
				<Button
					type="button"
					variant="outline"
					disabled={pending}
					aria-busy={pending}
					onClick={() => startTransition(() => router.refresh())}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}

/** Display scope only. Server admission and category/employee queries remain authoritative. */
export function PersonnelFilesWorkspace({
	userId,
	organizationId,
	employees,
	capability,
	attention,
}: {
	userId: string;
	organizationId: string;
	employees: readonly ManagedEmployee[] | null;
	capability: {
		payslipBatches: boolean;
		documentRequests: boolean;
		sickLeave: boolean;
		officerSettings: boolean;
	};
	attention: ReactNode;
}) {
	const { t } = useTranslate();
	const current = useOrganization();
	const directoryHeading = useId();
	const workflowsHeading = useId();
	if (
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId
	)
		return null;
	return (
		<div className="@container/main flex min-w-0 flex-1 flex-col gap-8 p-4 md:p-6">
			<PersonnelFilesHeading />
			{attention}
			<section aria-labelledby={directoryHeading} className="min-w-0 space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<h2 id={directoryHeading} className="text-lg font-semibold">
						{t(
							"settings.personnelFiles.area.employeeRecords",
							"Employee records",
						)}
					</h2>
					{employees ? (
						<Badge variant="secondary" className="tabular-nums">
							{employees.length}
						</Badge>
					) : null}
				</div>
				{employees === null ? (
					<PersonnelFilesReadFailure>
						{t(
							"settings.personnelFiles.area.employeesFailed",
							"Employee records could not be loaded. Try again.",
						)}
					</PersonnelFilesReadFailure>
				) : employees.length === 0 ? (
					<div className="space-y-2 rounded-lg border bg-card p-6 text-sm">
						<p className="font-medium">
							{t(
								"settings.personnelFiles.area.empty",
								"No employees are in your scope yet.",
							)}
						</p>
						<p className="text-muted-foreground">
							{t(
								"settings.personnelFiles.area.emptyGuidance",
								"Contact an organization administrator to review the employees, teams and document categories assigned to you.",
							)}
						</p>
					</div>
				) : (
					<EmployeeDirectoryCard
						employees={employees}
						basePath="/personnel-files"
						formerEmployeeLabel={t(
							"settings.personnelFiles.area.former",
							"Former employee",
						)}
					/>
				)}
			</section>
			<nav
				aria-labelledby={workflowsHeading}
				className="space-y-3 border-t pt-6"
			>
				<h2 id={workflowsHeading} className="text-sm font-semibold">
					{t(
						"settings.personnelFiles.area.workflows",
						"Personnel file workflows",
					)}
				</h2>
				<div className="flex flex-wrap gap-2">
					{capability.payslipBatches ? (
						<Button asChild variant="outline">
							<Link href="/personnel-files/payslip-batches">
								<IconFileStack aria-hidden="true" className="size-4" />
								{t(
									"settings.personnelFiles.area.payslipBatch",
									"Payslip batch",
								)}
							</Link>
						</Button>
					) : null}
					{capability.documentRequests ? (
						<Button asChild variant="outline">
							<Link href="/personnel-files/document-requests">
								<IconClipboardList aria-hidden="true" className="size-4" />
								{t(
									"settings.personnelFiles.area.documentRequests",
									"Document requests",
								)}
							</Link>
						</Button>
					) : null}
					{capability.sickLeave ? (
						<Button asChild variant="outline">
							<Link href="/personnel-files/sick-leave">
								<IconFirstAidKit aria-hidden="true" className="size-4" />
								{t("settings.personnelFiles.area.sickLeave", "Sick leave")}
							</Link>
						</Button>
					) : null}
					<Button asChild variant="outline">
						<Link href="/personnel-files/due-for-deletion">
							<IconTrashX aria-hidden="true" className="size-4" />
							{t(
								"settings.personnelFiles.area.dueForDeletion",
								"Due for deletion",
							)}
						</Link>
					</Button>
					{capability.officerSettings ? (
						<Button asChild variant="outline">
							<Link href="/settings/personnel-files">
								<IconSettings aria-hidden="true" className="size-4" />
								{t(
									"settings.personnelFiles.area.manageOfficers",
									"Personnel file officers",
								)}
							</Link>
						</Button>
					) : null}
				</div>
			</nav>
		</div>
	);
}
