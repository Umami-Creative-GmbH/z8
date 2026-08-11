import type { ColumnDef } from "@tanstack/react-table";
import type { TFnType } from "@tolgee/react";
import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
import { WorkPolicyActionMenu } from "./work-policy-action-menu";
import { WorkPolicyBreakRulesCell } from "./work-policy-break-rules-cell";
import { WorkPolicyFeaturesCell } from "./work-policy-features-cell";
import { WorkPolicyNameCell } from "./work-policy-name-cell";
import { WorkPolicyScheduleHoursCell } from "./work-policy-schedule-hours-cell";

export function getWorkPolicyTableColumns({
	t,
	canManagePolicies,
	onEdit,
	onDuplicate,
	onSetDefault,
	onDelete,
	isDuplicatePending,
	isSetDefaultPending,
}: {
	t: TFnType;
	canManagePolicies: boolean;
	onEdit: (policy: WorkPolicyWithDetails) => void;
	onDuplicate: (policyId: string) => void;
	onSetDefault: (policyId: string) => void;
	onDelete: (policy: WorkPolicyWithDetails) => void;
	isDuplicatePending: boolean;
	isSetDefaultPending: boolean;
}): ColumnDef<DataTableFeatures, WorkPolicyWithDetails>[] {
	return [
		{
			accessorKey: "name",
			header: t("settings.workPolicies.name", "Name"),
			cell: ({ row }) => <WorkPolicyNameCell policy={row.original} t={t} />,
		},
		{
			accessorKey: "features",
			header: () => (
				<div className="text-center">{t("settings.workPolicies.features", "Features")}</div>
			),
			cell: ({ row }) => <WorkPolicyFeaturesCell policy={row.original} t={t} />,
		},
		{
			accessorKey: "scheduleHours",
			header: () => (
				<div className="text-center">{t("settings.workPolicies.weeklyHours", "Weekly Hours")}</div>
			),
			cell: ({ row }) => <WorkPolicyScheduleHoursCell policy={row.original} />,
		},
		{
			accessorKey: "breakRules",
			header: () => (
				<div className="text-center">{t("settings.workPolicies.breakRules", "Break Rules")}</div>
			),
			cell: ({ row }) => <WorkPolicyBreakRulesCell policy={row.original} />,
		},
		...(canManagePolicies
			? [
					{
						id: "actions",
						cell: ({ row }: { row: { original: WorkPolicyWithDetails } }) => (
							<WorkPolicyActionMenu
								policy={row.original}
								t={t}
								onEdit={onEdit}
								onDuplicate={onDuplicate}
								onSetDefault={onSetDefault}
								onDelete={onDelete}
								isDuplicatePending={isDuplicatePending}
								isSetDefaultPending={isSetDefaultPending}
							/>
						),
					},
				]
			: []),
	];
}
