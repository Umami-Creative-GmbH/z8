import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { DocumentRequestsSection } from "@/components/personnel-file/document-requests-section";
import { EmployeeFileLoadingHeading } from "@/components/personnel-file/employee-file-loading-heading";
import { EmployeeFileWorkspace } from "@/components/personnel-file/employee-file-workspace";
import { EmployeeSickLeaveCard } from "@/components/personnel-file/employee-sick-leave-card";
import { PersonnelFilePanel } from "@/components/personnel-file/personnel-file-panel";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { listManagedEmployees } from "@/lib/personnel-file/access-store";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { isDocumentCategory } from "@/lib/personnel-file/document.types";
import { personnelFilePanelCapabilityFor } from "@/lib/personnel-file/panel";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

interface PersonnelFilePageProps {
	params: Promise<{ employeeId: string }>;
	searchParams: Promise<{ category?: string | string[] }>;
}

/**
 * One employee's personnel file in the officer area (#866), for whoever
 * manages at least one of its categories. Not found for everyone else.
 * `?category=` opens it filtered, e.g. from a sick note notification (#982).
 * Its requests section (#1401) shows to whoever covers certificates or other
 * documents of the employee.
 */
async function PersonnelFileContent({ params, searchParams }: PersonnelFilePageProps) {
	const [current, { employeeId }, { category }] = await Promise.all([
		loadCurrentPersonnelFileAccess(),
		params,
		searchParams,
	]);
	if (current.status !== "resolved" || !isCanonicalUuid(employeeId)) notFound();
	const [capability, [employee]] = await Promise.all([
		personnelFilePanelCapabilityFor(current.access, employeeId),
		listManagedEmployees(db, current.access, { employeeId }),
	]);
	if (!capability || !employee) notFound();

	return (
		<EmployeeFileWorkspace
			key={`${current.access.userId}:${current.access.organizationId}:${employeeId}:${capability.categories.join(",")}`}
			readId={randomUUID()}
			userId={current.access.userId}
			organizationId={current.access.organizationId}
			employee={employee}
		>
			<PersonnelFilePanel
				key={isDocumentCategory(category) ? category : "all"}
				capability={capability}
				initialCategory={
					isDocumentCategory(category) && capability.categories.includes(category) ? category : null
				}
			/>
			<DocumentRequestsSection capability={capability} former={!employee.isActive} />
			{capability.categories.includes("sick_note") ? (
				<EmployeeSickLeaveCard employeeId={capability.employeeId} />
			) : null}
		</EmployeeFileWorkspace>
	);
}

function PersonnelFileLoading() {
	return (
		<div className="@container/main page-frame flex flex-1 flex-col gap-6">
			<EmployeeFileLoadingHeading />
			<LoadingRegion
				label={{
					labelKey: "settings.personnelFiles.area.loadingFile",
					labelDefault: "Loading the personnel file",
				}}
				className="flex flex-1 flex-col gap-6"
				role="status"
			>
				<Skeleton aria-hidden="true" className="h-8 w-48" />
				<Skeleton aria-hidden="true" className="h-64 w-full" />
			</LoadingRegion>
		</div>
	);
}

export default function PersonnelFilePage(props: PersonnelFilePageProps) {
	return (
		<Suspense fallback={<PersonnelFileLoading />}>
			<PersonnelFileContent {...props} />
		</Suspense>
	);
}
