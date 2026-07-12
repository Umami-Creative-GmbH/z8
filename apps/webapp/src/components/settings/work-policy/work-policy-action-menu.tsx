import {
	IconCopy,
	IconDots,
	IconPencil,
	IconStar,
	IconTrash,
} from "@tabler/icons-react";
import type { TFnType } from "@tolgee/react";
import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface WorkPolicyActionMenuProps {
	policy: WorkPolicyWithDetails;
	t: TFnType;
	onEdit: (policy: WorkPolicyWithDetails) => void;
	onDuplicate: (policyId: string) => void;
	onSetDefault: (policyId: string) => void;
	onDelete: (policy: WorkPolicyWithDetails) => void;
	isDuplicatePending: boolean;
	isSetDefaultPending: boolean;
}

export function WorkPolicyActionMenu({
	policy,
	t,
	onEdit,
	onDuplicate,
	onSetDefault,
	onDelete,
	isDuplicatePending,
	isSetDefaultPending,
}: WorkPolicyActionMenuProps) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-8"
					aria-label={t("common.openMenu", "Open menu")}
				>
					<IconDots className="size-4" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => onEdit(policy)}>
					<IconPencil className="mr-2 size-4" />
					{t("common.edit", "Edit")}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => onDuplicate(policy.id)} disabled={isDuplicatePending}>
					<IconCopy className="mr-2 size-4" />
					{t("common.duplicate", "Duplicate")}
				</DropdownMenuItem>
				{!policy.isDefault ? (
					<DropdownMenuItem onClick={() => onSetDefault(policy.id)} disabled={isSetDefaultPending}>
						<IconStar className="mr-2 size-4" />
						{t("settings.workPolicies.setAsDefault", "Set as Default")}
					</DropdownMenuItem>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					className="text-destructive"
					onClick={() => onDelete(policy)}
					disabled={policy.isDefault}
				>
					<IconTrash className="mr-2 size-4" />
					{t("common.delete", "Delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
