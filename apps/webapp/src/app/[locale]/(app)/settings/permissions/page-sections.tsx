"use client";

import { IconShield } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Card, CardContent } from "@/components/ui/card";

export { PermissionEditorDialog } from "./permission-editor-dialog";
export { PermissionsTableCard } from "./permissions-table-card";

export function PermissionsEmptyState({ noEmployee }: { noEmployee: boolean }) {
	const { t } = useTranslate();

	if (noEmployee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError
					feature={t("settings.permissions.noEmployeeFeature", "manage permissions")}
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<Card>
				<CardContent className="flex flex-col items-center justify-center py-8">
					<IconShield className="mb-4 size-12 text-muted-foreground" />
					<p className="text-sm text-muted-foreground">
						{t("settings.permissions.adminRequired", "Admin access required")}
					</p>
				</CardContent>
			</Card>
		</div>
	);
}
