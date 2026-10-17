"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The "•••" menu of a list row that offers Edit and a destructive Delete
 * (API keys, invite codes).
 */
export function EditDeleteMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
	const { t } = useTranslate();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="sm" aria-label={t("common.moreActions", "More actions")}>
					•••
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={onEdit}>{t("common.edit", "Edit")}</DropdownMenuItem>
				<DropdownMenuItem onClick={onDelete} className="text-destructive">
					{t("common.delete", "Delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
