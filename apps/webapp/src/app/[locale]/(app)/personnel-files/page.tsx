import {
	IconFileStack,
	IconFirstAidKit,
	IconSettings,
	IconTrashX,
} from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmployeeDirectoryCard } from "@/components/employees/employee-directory-card";
import { ExpiringDocumentsCard } from "@/components/personnel-file/expiring-documents";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { systemClock } from "@/lib/datetime/temporal-core";
import {
	managesAnyDocuments,
	managesCategory,
} from "@/lib/personnel-file/access";
import { listManagedEmployees } from "@/lib/personnel-file/access-store";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import {
	listExpiringDocuments,
	loadExpiryReminderLeadDays,
} from "@/lib/personnel-file/expiry-store";
import { canRunPayslipBatches } from "@/lib/personnel-file/payslip-batch-store";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/**
 * Personnel files (#866): the employees whose personnel file the actor
 * manages. Personnel file officers reach their files here (they may be plain
 * members without the employee settings); owners and admins see everyone.
 * Not found for everyone else and while personnel files are off. Expiring
 * documents (#869) are listed above the employees.
 */
async function PersonnelFilesContent() {
	const [t, current] = await Promise.all([
		getTranslate(),
		loadCurrentPersonnelFileAccess(),
	]);
	if (current.status !== "resolved" || !managesAnyDocuments(current.access))
		notFound();
	const [employees, expiring, leadDays] = await Promise.all([
		listManagedEmployees(db, current.access),
		listExpiringDocuments(db, current.access, {
			now: systemClock.nowInstant(),
		}),
		loadExpiryReminderLeadDays(db, current.access.organizationId),
	]);
	const isOrganizationAdmin = current.access.grants.some(
		(grant) => grant.source === "organization_admin",
	);

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="space-y-1">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.personnelFiles.area.title", "Personnel Files")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"settings.personnelFiles.area.description",
							"The employees whose personnel file you manage.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					{canRunPayslipBatches(current.access) ? (
						<Button asChild>
							<Link href="/personnel-files/payslip-batches">
								<IconFileStack aria-hidden="true" className="size-4" />
								{t(
									"settings.personnelFiles.area.payslipBatch",
									"Payslip batch",
								)}
							</Link>
						</Button>
					) : null}
					{managesCategory(current.access, "sick_note") ? (
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
					{isOrganizationAdmin ? (
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
			</header>
			<ExpiringDocumentsCard documents={expiring} leadDays={leadDays} />
			{employees.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.personnelFiles.area.empty",
						"No employees are in your scope yet.",
					)}
				</p>
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
		</div>
	);
}

function PersonnelFilesLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.area.loading",
				labelDefault: "Loading personnel files",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
			<Skeleton aria-hidden="true" className="h-16 w-full" />
		</LoadingRegion>
	);
}

export default function PersonnelFilesPage() {
	return (
		<Suspense fallback={<PersonnelFilesLoading />}>
			<PersonnelFilesContent />
		</Suspense>
	);
}
