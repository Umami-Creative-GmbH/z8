"use client";

import { IconArrowLeft } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import type { ManagedEmployee } from "@/lib/personnel-file/access-store";
import { Link } from "@/navigation";
import { EmployeeFileLoadingHeading } from "./employee-file-loading-heading";

/** Display guard only. Every reader, command and content URL still authorizes independently. */
export function EmployeeFileWorkspace({
	userId,
	organizationId,
	employee,
	children,
}: {
	userId: string;
	organizationId: string;
	employee: ManagedEmployee;
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const current = useOrganization();
	if (
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId
	)
		return (
			<div className="p-4 md:p-6">
				<EmployeeFileLoadingHeading />
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
								{t(
									"settings.personnelFiles.employeeFile.number",
									"Personnel number: {number}",
									{ number: employee.employeeNumber },
								)}
							</span>
						) : null}
					</div>
				}
			/>
			{children}
		</div>
	);
}
