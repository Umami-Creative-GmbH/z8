"use client";
import { IconChevronDown, IconPackage } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import type {
	EquipmentAssignmentView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { CorrectionHistory } from "./equipment-corrections";
import { EquipmentExceptionTotals } from "./equipment-exceptions";
import { EquipmentHistory } from "./equipment-history";
import { groupPersonalAssignments } from "./equipment-list";
import { EquipmentPersonalHeader } from "./equipment-personal-header";
import {
	AssignmentStatusBadge,
	DeadlineText,
	ItemIdentity,
} from "./equipment-status";

function PersonalRow({
	assignment,
	data,
}: {
	assignment: EquipmentAssignmentView;
	data: EquipmentView;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const corrections = assignment.corrections ?? [];
	return (
		<Collapsible render={<li />} className="[content-visibility:auto]">
			<CollapsibleTrigger className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6 @4xl/main:grid-cols-[minmax(0,1fr)_9rem_10rem_10rem_auto]">
				<span className="min-w-0 [&_.truncate]:whitespace-normal [&_.truncate]:wrap-anywhere">
					<ItemIdentity assignment={assignment} />
				</span>
				<span className="col-span-2 flex flex-col gap-1 text-sm tabular-nums @4xl/main:col-span-1">
					{assignment.outstanding ? (
						<span className="font-medium">
							{t("settings.equipment.personal.remaining", "{count} to return", {
								count: assignment.outstandingQuantity.toLocaleString(locale),
							})}
						</span>
					) : null}
					<span className="text-muted-foreground">
						{t("settings.equipment.personal.quantity", "{count} issued", {
							count: assignment.quantity.toLocaleString(locale),
						})}
					</span>
				</span>
				<AssignmentStatusBadge
					assignment={assignment}
					className="col-span-2 max-w-full justify-self-start whitespace-normal @4xl/main:col-span-1"
				/>
				<span className="col-span-2 text-sm @4xl/main:col-span-1">
					<DeadlineText assignment={assignment} today={data.today} />
				</span>
				<span className="col-start-2 row-start-1 flex items-center gap-1 text-sm text-muted-foreground @4xl/main:col-start-auto @4xl/main:row-start-auto">
					<span className="hidden @4xl/main:inline">
						{t("settings.equipment.custody.history", "Handover history")}
					</span>
					<IconChevronDown
						className="size-4 shrink-0 transition-transform group-data-[panel-open]:rotate-180 motion-reduce:transition-none"
						aria-hidden="true"
					/>
				</span>
				<span className="sr-only">
					{t(
						"settings.equipment.personal.toggleHistory",
						"Show handover history",
					)}
				</span>
			</CollapsibleTrigger>
			<CollapsibleContent className="space-y-4 border-t bg-muted/20 px-4 py-5 wrap-anywhere sm:px-6">
				<dl className="grid gap-3 text-sm sm:grid-cols-3">
					<div>
						<dt className="text-muted-foreground">
							{t(
								"settings.equipment.custody.issuedQuantity",
								"Issued quantity",
							)}
						</dt>
						<dd className="tabular-nums">
							{assignment.quantity.toLocaleString(locale)}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">
							{t(
								"settings.equipment.custody.receivedQuantity",
								"Physically received quantity",
							)}
						</dt>
						<dd className="tabular-nums">
							{assignment.physicallyReceivedQuantity.toLocaleString(locale)}
						</dd>
					</div>
					<div>
						<dt className="text-muted-foreground">
							{t(
								"settings.equipment.custody.outstandingQuantity",
								"Outstanding quantity",
							)}
						</dt>
						<dd className="tabular-nums">
							{assignment.outstandingQuantity.toLocaleString(locale)}
						</dd>
					</div>
				</dl>
				<EquipmentExceptionTotals assignment={assignment} />
				<section
					aria-label={t(
						"settings.equipment.custody.history",
						"Handover history",
					)}
				>
					<h3 className="mb-3 text-sm font-medium">
						{t("settings.equipment.custody.history", "Handover history")}
					</h3>
					<EquipmentHistory
						assignment={assignment}
						timezone={data.timezone}
						today={data.today}
					/>
				</section>
				{corrections.length ? (
					<details className="border-t pt-4">
						<summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
							{t(
								"settings.equipment.correction.history",
								"Original records and amendments",
							)}
						</summary>
						<div className="mt-3">
							<CorrectionHistory
								corrections={corrections}
								timezone={data.timezone}
							/>
						</div>
					</details>
				) : null}
			</CollapsibleContent>
		</Collapsible>
	);
}

function PersonalGroup({
	title,
	assignments,
	data,
}: {
	title: string;
	assignments: EquipmentAssignmentView[];
	data: EquipmentView;
}) {
	const { t } = useTranslate();
	if (!assignments.length) return null;
	return (
		<Card className="gap-0 overflow-hidden py-0">
			<CardHeader className="flex flex-row items-baseline justify-between gap-3 py-5">
				<h2 className="font-semibold leading-none">{title}</h2>
				<span className="text-sm text-muted-foreground tabular-nums">
					{t(
						"settings.equipment.personal.count",
						"{count, plural, one {# item} other {# items}}",
						{ count: assignments.length },
					)}
				</span>
			</CardHeader>
			<CardContent className="px-0">
				<ul className="divide-y border-t">
					{assignments.map((assignment) => (
						<PersonalRow
							key={assignment.id}
							assignment={assignment}
							data={data}
						/>
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

/**
 * The employee's own equipment (#1572), read-only: what to return and by when,
 * what is theirs to keep, and what came back or was closed. Each row opens its
 * handover history in place.
 */
export function PersonalEquipment({ data }: { data: EquipmentView }) {
	const { t } = useTranslate();
	const locale = useLocale();
	const groups = groupPersonalAssignments(data.assignments, locale);
	return (
		<div className="space-y-6">
			<EquipmentPersonalHeader calendar={data} />
			<div className="flex flex-col gap-6">
				{data.assignments.length ? (
					<>
						<PersonalGroup
							title={t("settings.equipment.personal.toReturn", "To return")}
							assignments={groups.toReturn}
							data={data}
						/>
						<PersonalGroup
							title={t("settings.equipment.personal.keep", "Yours to keep")}
							assignments={groups.keep}
							data={data}
						/>
						<PersonalGroup
							title={t(
								"settings.equipment.personal.closed",
								"Returned & closed",
							)}
							assignments={groups.closed}
							data={data}
						/>
					</>
				) : (
					<Empty className="border bg-card md:p-16">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<IconPackage aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>
								{t(
									"settings.equipment.personal.emptyTitle",
									"No equipment recorded",
								)}
							</EmptyTitle>
							<EmptyDescription>
								{t(
									"settings.equipment.personal.emptyDescription",
									"Equipment issued to you appears here with its return deadline and handover history.",
								)}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)}
			</div>
		</div>
	);
}
