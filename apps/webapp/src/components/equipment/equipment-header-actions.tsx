"use client";
import {
	IconChevronDown,
	IconHistory,
	IconPlus,
	IconRefresh,
	IconSettings,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/navigation";

/** Reloads the server read; the icon spins until the refreshed page arrives. */
export function EquipmentRefreshButton() {
	const { t } = useTranslate();
	const router = useRouter();
	const [refreshing, startTransition] = useTransition();
	const label = t("settings.equipment.custody.reload", "Reload equipment");
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={label}
			title={label}
			aria-busy={refreshing}
			disabled={refreshing}
			onClick={() => startTransition(() => router.refresh())}
		>
			<IconRefresh
				className={cn("size-4", refreshing && "animate-spin")}
				aria-hidden="true"
			/>
		</Button>
	);
}

export function EquipmentSettingsLink() {
	const { t } = useTranslate();
	return (
		<Button asChild variant="outline">
			<Link href="/settings/equipment">
				<IconSettings className="size-4" aria-hidden="true" />
				{t("settings.equipment.settingsLink", "Equipment settings")}
			</Link>
		</Button>
	);
}

/**
 * "Issue equipment" with "Record existing holding" in its attached menu. Where
 * only a historical holding may be recorded (a former employee), that is the
 * one button.
 */
export function EquipmentIssueActions({
	canIssue,
	canRecordHistorical,
	disabled,
	onIssue,
	onRecordHistorical,
}: {
	canIssue: boolean;
	canRecordHistorical: boolean;
	disabled?: boolean;
	onIssue: () => void;
	onRecordHistorical: () => void;
}) {
	const { t } = useTranslate();
	const historicalLabel = t(
		"settings.equipment.historical.title",
		"Record existing holding",
	);
	if (!canIssue)
		return canRecordHistorical ? (
			<Button
				variant="outline"
				disabled={disabled}
				onClick={onRecordHistorical}
			>
				<IconHistory className="size-4" aria-hidden="true" />
				{historicalLabel}
			</Button>
		) : null;
	return (
		<div className="flex w-fit items-stretch">
			<Button
				className={cn(canRecordHistorical && "rounded-r-none")}
				disabled={disabled}
				onClick={onIssue}
			>
				<IconPlus className="size-4" aria-hidden="true" />
				{t("settings.equipment.custody.issue", "Issue equipment")}
			</Button>
			{canRecordHistorical ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							size="icon"
							disabled={disabled}
							className="rounded-l-none border-l border-primary-foreground/20"
							aria-label={t(
								"settings.equipment.custody.moreIssueOptions",
								"More ways to record equipment",
							)}
						>
							<IconChevronDown className="size-4" aria-hidden="true" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={onRecordHistorical}>
							<IconHistory aria-hidden="true" />
							{historicalLabel}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</div>
	);
}
