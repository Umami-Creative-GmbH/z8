"use client";

import { useTranslate } from "@tolgee/react";
import { PermissionEditor } from "@/components/settings/permission-editor";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import type { EmployeePermissions } from "@/lib/effect/services/permissions.service";
import type { SelectableEmployee } from "../employees/actions";
import type { TeamItem } from "./page-utils";

export function PermissionEditorDialog(props: {
	selectedEmployee: SelectableEmployee | null;
	currentEmployee: { organizationId: string } | null;
	teams: TeamItem[];
	currentPermissions: Record<string, EmployeePermissions>;
	onClose: () => void;
	onSuccess: () => void;
}) {
	const { t } = useTranslate();
	const {
		selectedEmployee,
		currentEmployee,
		teams,
		currentPermissions,
		onClose,
		onSuccess,
	} = props;

	return (
		<ActionPanel
			open={!!selectedEmployee}
			onOpenChange={(open) => !open && onClose()}
		>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t(
							"settings.permissions.editor.title",
							"Edit Permissions - {name}",
							{
								name: selectedEmployee?.user.name ?? "",
							},
						)}
					</ActionPanelTitle>
				</ActionPanelHeader>
				<ActionPanelBody>
					{selectedEmployee && currentEmployee ? (
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
