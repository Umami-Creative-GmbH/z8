import { IconArrowLeft } from "@tabler/icons-react";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PersonnelFilePanel } from "@/components/personnel-file/personnel-file-panel";
import { Badge } from "@/components/ui/badge";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/db";
import { listManagedEmployees } from "@/lib/personnel-file/access-store";
import { loadCurrentPersonnelFileAccess } from "@/lib/personnel-file/current-access";
import { isDocumentCategory } from "@/lib/personnel-file/document.types";
import { personnelFilePanelCapabilityFor } from "@/lib/personnel-file/panel";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

interface PersonnelFilePageProps {
	params: Promise<{ employeeId: string }>;
	searchParams: Promise<{ category?: string | string[] }>;
}

/**
 * One employee's personnel file in the officer area (#866), for whoever
 * manages at least one of its categories. Not found for everyone else.
 * `?category=` opens it filtered, e.g. from a sick note notification (#982).
 */
async function PersonnelFileContent({ params, searchParams }: PersonnelFilePageProps) {
	const [t, current, { employeeId }, { category }] = await Promise.all([
		getTranslate(),
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
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6">
			<header className="space-y-2">
				<Link
					href="/personnel-files"
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<IconArrowLeft aria-hidden="true" className="size-4" />
					{t("settings.personnelFiles.area.back", "Personnel files")}
				</Link>
				<div className="flex flex-wrap items-center gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">{employee.name}</h1>
					{employee.isActive ? null : (
						<Badge variant="secondary">
							{t("settings.personnelFiles.area.former", "Former employee")}
						</Badge>
					)}
				</div>
			</header>
			<PersonnelFilePanel
				capability={capability}
				initialCategory={
					isDocumentCategory(category) && capability.categories.includes(category) ? category : null
				}
			/>
		</div>
	);
}

function PersonnelFileLoading() {
	return (
		<LoadingRegion
			label={{
				labelKey: "settings.personnelFiles.area.loadingFile",
				labelDefault: "Loading the personnel file",
			}}
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
		>
			<Skeleton aria-hidden="true" className="h-8 w-48" />
			<Skeleton aria-hidden="true" className="h-64 w-full" />
		</LoadingRegion>
	);
}

export default function PersonnelFilePage(props: PersonnelFilePageProps) {
	return (
		<Suspense fallback={<PersonnelFileLoading />}>
			<PersonnelFileContent {...props} />
		</Suspense>
	);
}
