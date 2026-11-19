"use client";

import { IconShield } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export { PermissionEditorDialog } from "./permission-editor-dialog";
export { PermissionsTableCard } from "./permissions-table-card";

export function PermissionsPageHeader() {
	const { t } = useTranslate();

	return (
		<PageHeader
			title={t("settings.permissions.title", "Team Permissions")}
			description={t(
				"settings.permissions.description",
				"Manage employee permissions for team operations",
			)}
		/>
	);
}

export function PermissionsEmptyState({ noEmployee }: { noEmployee: boolean }) {
	const { t } = useTranslate();

	return (
		<div className="page-frame flex flex-1 flex-col gap-6">
			<PermissionsPageHeader />
			{noEmployee ? (
				<NoEmployeeError
					className="w-full max-w-xl"
					feature={t("settings.permissions.noEmployeeFeature", "manage permissions")}
				/>
			) : (
				<Card>
					<CardContent className="flex flex-col items-start gap-3 py-6 sm:items-center sm:text-center">
						<IconShield className="size-8 text-muted-foreground" aria-hidden="true" />
						<p className="text-sm text-muted-foreground">
							{t("settings.permissions.adminRequired", "Admin access required")}
						</p>
					</CardContent>
				</Card>
			)}
		</div>
	);
}
