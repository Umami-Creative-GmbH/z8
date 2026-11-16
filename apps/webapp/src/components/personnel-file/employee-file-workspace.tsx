"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import type { ManagedEmployee } from "@/lib/personnel-file/access-store";
import { Link } from "@/navigation";
import { EmployeeFileLoadingHeading } from "./employee-file-loading-heading";
import { PersonnelFilesReadFailure } from "./personnel-files-workspace";
import { usePersonnelFilesSnapshot } from "./use-personnel-files-snapshot";

/** Display guard only. Every reader, command and content URL still authorizes independently. */
export function EmployeeFileWorkspace({
	readId,
	userId,
	organizationId,
	employee,
	children,
}: {
	/** Identity of this completed, canonically admitted server read. */
	readId: string;
	userId: string;
	organizationId: string;
	employee: ManagedEmployee;
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const snapshot = usePersonnelFilesSnapshot({ readId, userId, organizationId });
	if (!snapshot.visible)
		return (
			<div className="flex flex-col gap-6 p-4 md:p-6">
				<EmployeeFileLoadingHeading />
				{snapshot.pending ? (
					<LoadingRegion
						label={{
							labelKey: "settings.personnelFiles.area.confirmingAccess",
							labelDefault: "Confirming personnel-file access",
						}}
						role="status"
					/>
				) : (
					<PersonnelFilesReadFailure>
						{t(
							"settings.personnelFiles.employeeFile.refreshAccess",
							"Refresh this personnel file before continuing.",
						)}
					</PersonnelFilesReadFailure>
				)}
			</div>
		);
	return (
		<div className="@container/main mx-auto flex w-full max-w-[100rem] flex-1 flex-col gap-6 p-4 md:p-6">
			<PageHeader
				title={employee.name}
				scope={
					<Link
						href="/personnel-files"
						className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
					>
						<IconArrowLeft aria-hidden="true" className="size-4" />
						{t("settings.personnelFiles.area.back", "Personnel files")}
					</Link>
				}
				description={
					<div className="flex flex-wrap items-center gap-2">
						{employee.isActive ? null : (
							<Badge variant="secondary">
								{t("settings.personnelFiles.area.former", "Former employee")}
							</Badge>
						)}
						{employee.employeeNumber ? (
							<span>
								{t("settings.personnelFiles.employeeFile.number", "Personnel number: {number}", {
									number: employee.employeeNumber,
								})}
							</span>
						) : null}
					</div>
				}
			/>
			{children}
		</div>
	);
}
