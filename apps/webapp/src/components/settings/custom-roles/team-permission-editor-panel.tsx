"use client";

import { useTranslate } from "@tolgee/react";
import type { SelectableEmployee } from "@/app/[locale]/(app)/settings/employees/employee-action-types";
import { PermissionEditor } from "@/components/settings/permission-editor";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import type { EmployeePermissions } from "@/lib/effect/services/permissions.service";
import type { TeamItem } from "./team-permissions-utils";

export function TeamPermissionEditorPanel(props: {
	selectedEmployee: SelectableEmployee | null;
	teams: TeamItem[];
	currentPermissions: Record<string, EmployeePermissions>;
	onClose: () => void;
	onSuccess: () => void;
}) {
	const { t } = useTranslate();
	const { selectedEmployee, teams, currentPermissions, onClose, onSuccess } = props;

	return (
		<ActionPanel open={!!selectedEmployee} onOpenChange={(open) => !open && onClose()}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("settings.permissions.editor.title", "Edit Permissions - {name}", {
							name: selectedEmployee?.user.name ?? "",
						})}
					</ActionPanelTitle>
				</ActionPanelHeader>
				<ActionPanelBody>
					{selectedEmployee ? (
						<PermissionEditor
							employeeId={selectedEmployee.id}
							employeeName={selectedEmployee.user.name}
							currentPermissions={currentPermissions[selectedEmployee.id]}
							availableTeams={teams}
							onSuccess={onSuccess}
							onCancel={onClose}
						/>
					) : null}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}
