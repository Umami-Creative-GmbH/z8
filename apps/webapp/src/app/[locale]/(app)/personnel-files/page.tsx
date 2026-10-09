import { IconChevronRight, IconSettings, IconTrashX } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { managesAnyDocuments } from "@/lib/personnel-file/access";
import { listManagedEmployees } from "@/lib/personnel-file/access-store";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/**
 * Personnel files (#866): the employees whose personnel file the actor
 * manages. Personnel file officers reach their files here (they may be plain
 * members without the employee settings); owners and admins see everyone.
 * Not found for everyone else and while personnel files are off.
 */
async function PersonnelFilesContent() {
	const [t, current] = await Promise.all([getTranslate(), loadCurrentPersonnelFileAccess()]);
	if (current.status !== "resolved" || !managesAnyDocuments(current.access)) notFound();
	const employees = await listManagedEmployees(db, current.access);
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
					<Button asChild variant="outline">
						<Link href="/personnel-files/due-for-deletion">
							<IconTrashX aria-hidden="true" className="size-4" />
							{t("settings.personnelFiles.area.dueForDeletion", "Due for deletion")}
						</Link>
					</Button>
					{isOrganizationAdmin ? (
						<Button asChild variant="outline">
							<Link href="/settings/personnel-files">
								<IconSettings aria-hidden="true" className="size-4" />
								{t("settings.personnelFiles.area.manageOfficers", "Personnel file officers")}
							</Link>
						</Button>
					) : null}
				</div>
			</header>
			{employees.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t("settings.personnelFiles.area.empty", "No employees are in your scope yet.")}
				</p>
			) : (
				<Card className="py-0">
					<CardContent className="px-0">
						<ul className="divide-y">
							{employees.map((employee) => (
								<li key={employee.id}>
									<Link
										href={`/personnel-files/${employee.id}`}
										className="flex min-w-0 items-center gap-3 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
									>
										<span className="min-w-0 flex-1">
											<span className="block truncate font-medium">{employee.name}</span>
											{employee.employeeNumber ? (
												<span className="block text-sm text-muted-foreground tabular-nums">
													{employee.employeeNumber}
												</span>
											) : null}
										</span>
										{employee.isActive ? null : (
											<Badge variant="secondary">
												{t("settings.personnelFiles.area.former", "Former employee")}
											</Badge>
										)}
										<IconChevronRight
											aria-hidden="true"
											className="size-4 shrink-0 text-muted-foreground"
										/>
									</Link>
								</li>
							))}
						</ul>
					</CardContent>
				</Card>
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
