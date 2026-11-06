"use client";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { FormerEmployeeBadge } from "@/components/former-employees/former-employee-ui";
import { Badge } from "@/components/ui/badge";
import { UserAvatar, type UserAvatarSize } from "@/components/user-avatar";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import type { EquipmentAssignmentView } from "@/lib/organization/equipment/contracts";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import {
	type AssignmentStatusKind,
	assignmentStatus,
	deadlineState,
} from "./equipment-list";

/** Calendar dates and recorded instants, both shown in the organization's zone. */
export function useEquipmentDates(timezone: string) {
	const locale = useLocale();
	return {
		date: (value: string) =>
			parsePlainDate(value).toLocaleString(locale, { dateStyle: "medium" }),
		instant: (value: string) =>
			parseInstant(value)
				.toZonedDateTimeISO(timezone)
				.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }),
		instantDate: (value: string) =>
			parseInstant(value)
				.toZonedDateTimeISO(timezone)
				.toPlainDate()
				.toLocaleString(locale, { dateStyle: "medium" }),
	};
}

const STATUS_VARIANT: Record<
	AssignmentStatusKind,
	"destructive" | "outline" | "secondary"
> = {
	overdue: "destructive",
	outstanding: "outline",
	keep: "secondary",
	received: "secondary",
	closed: "secondary",
};

export function useStatusLabel() {
	const { t } = useTranslate();
	return (kind: AssignmentStatusKind) => {
		switch (kind) {
			case "overdue":
				return t("settings.equipment.custody.overdue", "Overdue");
			case "outstanding":
				return t(
					"settings.equipment.custody.outstanding",
					"Outstanding return",
				);
			case "keep":
				return t("settings.equipment.custody.keep", "Issued to keep");
			case "received":
				return t("settings.equipment.custody.received", "Physically received");
			case "closed":
				return t(
					"settings.equipment.exception.closed",
					"Return obligation closed",
				);
		}
	};
}

export function AssignmentStatusBadge({
	assignment,
	className,
}: {
	assignment: Pick<
		EquipmentAssignmentView,
		"held" | "overdue" | "outstanding" | "returnRequired"
	>;
	className?: string;
}) {
	const label = useStatusLabel();
	const kind = assignmentStatus(assignment);
	return (
		<Badge variant={STATUS_VARIANT[kind]} className={className}>
			{label(kind)}
		</Badge>
	);
}

/** The effective return deadline with how urgent it is today; colour marks status only. */
export function DeadlineText({
	assignment,
	today,
	className,
}: {
	assignment: Pick<
		EquipmentAssignmentView,
		"effectiveDeadline" | "outstanding" | "overdue"
	>;
	today: string;
	className?: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const state = deadlineState(assignment, today);
	if (!assignment.effectiveDeadline || state.kind === "none")
		return (
			<span className={cn("text-muted-foreground", className)}>
				{t("settings.equipment.departure.noDeadline", "No deadline")}
			</span>
		);
	const date = (
		<time dateTime={assignment.effectiveDeadline} className="tabular-nums">
			{parsePlainDate(assignment.effectiveDeadline).toLocaleString(locale, {
				dateStyle: "medium",
			})}
		</time>
	);
	if (state.kind === "plain") return <span className={className}>{date}</span>;
	return (
		<span className={cn("inline-flex flex-col", className)}>
			<span
				className={cn(
					"font-medium",
					state.kind === "overdue"
						? "text-destructive"
						: "text-amber-700 dark:text-amber-400",
				)}
			>
				{date}
			</span>
			<span className="text-xs text-muted-foreground">
				{state.kind === "overdue"
					? t(
							"settings.equipment.deadline.overdueBy",
							"{count, plural, one {# day overdue} other {# days overdue}}",
							{ count: state.days },
						)
					: t(
							"settings.equipment.deadline.dueIn",
							"{count, plural, =0 {Due today} one {in # day} other {in # days}}",
							{ count: state.days },
						)}
			</span>
		</span>
	);
}

/** Avatar, name and former badge; staff readers get the name as a link to the holder's equipment. */
export function HolderIdentity({
	employeeId,
	name,
	image,
	former,
	href,
	size = "sm",
	secondary,
}: {
	employeeId: string;
	name: string;
	image: string | null | undefined;
	former: boolean;
	href?: string;
	size?: UserAvatarSize;
	secondary?: ReactNode;
}) {
	return (
		<span className="flex min-w-0 items-center gap-2.5">
			<UserAvatar
				seed={employeeId}
				image={image}
				name={name}
				size={size}
				showClockStatus={false}
			/>
			<span className="min-w-0">
				<span className="flex min-w-0 flex-wrap items-center gap-1.5">
					{href ? (
						<Link
							href={href}
							className="truncate font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
							onClick={(event) => event.stopPropagation()}
						>
							{name}
						</Link>
					) : (
						<span className="truncate font-medium">{name}</span>
					)}
					{former ? <FormerEmployeeBadge /> : null}
				</span>
				{secondary ? (
					<span className="block truncate text-xs text-muted-foreground">
						{secondary}
					</span>
				) : null}
			</span>
		</span>
	);
}

/** "L-01" with "Quantity · Shirts" or the type below; quantity types read as their type. */
export function ItemIdentity({
	assignment,
	href,
}: {
	assignment: Pick<
		EquipmentAssignmentView,
		"identifier" | "typeName" | "trackingMode"
	>;
	href?: string;
}) {
	const { t } = useTranslate();
	const title = <span translate="no">{assignment.identifier}</span>;
	return (
		<span className="block min-w-0">
			{href ? (
				<Link
					href={href}
					className="block truncate font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					onClick={(event) => event.stopPropagation()}
				>
					{title}
				</Link>
			) : (
				<span className="block truncate font-medium">{title}</span>
			)}
			<span className="block truncate text-xs text-muted-foreground">
				{assignment.trackingMode === "quantity"
					? t("settings.equipment.list.quantityType", "Quantity · {type}", {
							type: assignment.typeName,
						})
					: assignment.typeName}
			</span>
		</span>
	);
}
