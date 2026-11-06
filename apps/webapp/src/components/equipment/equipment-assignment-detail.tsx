"use client";
import {
	IconArrowsExchange,
	IconChevronDown,
	IconCircleX,
	IconPackage,
	IconPackageImport,
	IconStack2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { BackLink } from "@/components/travel-expenses/back-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
	EquipmentAssignmentView,
	EquipmentCorrectionView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { conditionLabel } from "./equipment-copy";
import { CorrectionHistory, CorrectionMenu } from "./equipment-corrections";
import { EquipmentExceptionTotals } from "./equipment-exceptions";
import { EquipmentRefreshButton } from "./equipment-header-actions";
import { EquipmentHistory } from "./equipment-history";
import {
	canTransfer,
	type EquipmentPanelSelection,
	useEquipmentPanels,
} from "./equipment-panels";
import { EquipmentRetention } from "./equipment-retention";
import {
	AssignmentStatusBadge,
	DeadlineText,
	HolderIdentity,
	useEquipmentDates,
} from "./equipment-status";

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="min-w-0 space-y-1">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="break-words font-medium">{children}</dd>
		</div>
	);
}

function AssignmentFacts({
	assignment,
	today,
	timezone,
}: {
	assignment: EquipmentAssignmentView;
	today: string;
	timezone: string;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const dates = useEquipmentDates(timezone);
	const count = (value: number) => (
		<span className="tabular-nums">{value.toLocaleString(locale)}</span>
	);
	return (
		<Card className="gap-4">
			<CardContent className="space-y-5">
				<dl className="grid grid-cols-2 gap-x-6 gap-y-5 text-sm @3xl/main:grid-cols-3">
					<Fact
						label={t(
							"settings.equipment.custody.issuedQuantity",
							"Issued quantity",
						)}
					>
						{count(assignment.quantity)}
					</Fact>
					<Fact
						label={t(
							"settings.equipment.custody.receivedQuantity",
							"Physically received quantity",
						)}
					>
						{count(assignment.physicallyReceivedQuantity)}
					</Fact>
					<Fact
						label={t(
							"settings.equipment.custody.outstandingQuantity",
							"Outstanding quantity",
						)}
					>
						{count(assignment.outstandingQuantity)}
					</Fact>
					<Fact
						label={t(
							"settings.equipment.custody.agreement",
							"Agreed return terms",
						)}
					>
						{assignment.returnRequired
							? t(
									"settings.equipment.handover.returnRequired",
									"Return required",
								)
							: t("settings.equipment.custody.keep", "Issued to keep")}
					</Fact>
					<Fact
						label={t(
							"settings.equipment.custody.effectiveDeadline",
							"Effective return deadline",
						)}
					>
						<DeadlineText assignment={assignment} today={today} />
					</Fact>
					{assignment.departureDeadline ? (
						<Fact
							label={t(
								"settings.equipment.custody.departureDeadline",
								"Departure return deadline",
							)}
						>
							<time dateTime={assignment.departureDeadline}>
								{dates.date(assignment.departureDeadline)}
							</time>
						</Fact>
					) : null}
					{assignment.explicitDeadline ? (
						<Fact
							label={t(
								"settings.equipment.custody.explicitDeadline",
								"Explicit return deadline",
							)}
						>
							<time dateTime={assignment.explicitDeadline}>
								{dates.date(assignment.explicitDeadline)}
							</time>
						</Fact>
					) : null}
					<Fact
						label={t(
							"settings.equipment.custody.latestCondition",
							"Latest recorded condition",
						)}
					>
						{conditionLabel(
							assignment.receipt?.condition ?? assignment.issue.condition,
							t,
						)}
					</Fact>
				</dl>
				<EquipmentExceptionTotals assignment={assignment} />
				{assignment.trackingMode === "individual" &&
				assignment.receipt?.condition === "damaged" ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.equipment.custody.damageHelp",
							"Return fulfilled. Damaged receipt requires separate clearance before reissue; see current item availability.",
						)}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}

/** The page's commands that this assignment still offers. */
function AssignmentActions({
	assignment,
	transferable,
	pending,
	open,
}: {
	assignment: EquipmentAssignmentView;
	transferable: boolean;
	pending: boolean;
	open: (selection: EquipmentPanelSelection) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="flex flex-wrap items-center gap-2">
			<EquipmentRefreshButton />
			{assignment.canCloseException ? (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => open({ kind: "closure", assignmentId: assignment.id })}
				>
					<IconCircleX className="size-4" aria-hidden="true" />
					{t("settings.equipment.exception.close", "Close return")}
				</Button>
			) : null}
			{transferable ? (
				<Button
					variant="outline"
					disabled={pending}
					onClick={() =>
						open({ kind: "transfer", assignmentId: assignment.id })
					}
				>
					<IconArrowsExchange className="size-4" aria-hidden="true" />
					{t("settings.equipment.list.transfer", "Transfer")}
				</Button>
			) : null}
			{assignment.canReceive ? (
				<Button
					disabled={pending}
					onClick={() => open({ kind: "receipt", assignmentId: assignment.id })}
				>
					<IconPackageImport className="size-4" aria-hidden="true" />
					{t("settings.equipment.handover.receive", "Record receipt")}
				</Button>
			) : null}
		</div>
	);
}

/** The original records and their amendments, collapsed behind a count. */
function AmendmentsCard({
	corrections,
	timezone,
}: {
	corrections: EquipmentCorrectionView[];
	timezone: string;
}) {
	const { t } = useTranslate();
	return (
		<Collapsible>
			<Card className="gap-0 py-0">
				<CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 rounded-xl px-6 py-4 text-left focus-visible:outline-2 focus-visible:outline-ring">
					<span className="font-semibold">
						{t(
							"settings.equipment.correction.history",
							"Original records and amendments",
						)}
					</span>
					<span className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
						{t(
							"settings.equipment.detail.corrections",
							"{count, plural, one {# amendment} other {# amendments}}",
							{ count: corrections.length },
						)}
						<IconChevronDown
							className="size-4 transition-transform group-data-[panel-open]:rotate-180"
							aria-hidden="true"
						/>
					</span>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<CardContent className="border-t py-5">
						<CorrectionHistory corrections={corrections} timezone={timezone} />
					</CardContent>
				</CollapsibleContent>
			</Card>
		</Collapsible>
	);
}

/**
 * One assignment's page (#1572): its facts, the handover history with its
 * amendments, the holder and record retention. Commands open in action panels.
 */
export function EquipmentAssignmentDetail({
	data,
	back,
}: {
	data: EquipmentView;
	back: string;
}) {
	const { t } = useTranslate();
	const { open, panel, pending, submit } = useEquipmentPanels(data);
	const assignment = data.assignments[0];
	if (!assignment) return null;
	const transferable = canTransfer(data, assignment);
	const corrections = assignment.corrections ?? [];
	const correctable = {
		...assignment,
		canCorrect: data.canManage && assignment.canCorrect,
		canCorrectReceipt: data.canManage && assignment.canCorrectReceipt,
		canCorrectException: data.canManage && assignment.canCorrectException,
	};
	const ItemIcon =
		assignment.trackingMode === "quantity" ? IconStack2 : IconPackage;
	const detailLine = [
		assignment.typeName,
		assignment.trackingMode === "quantity"
			? t("settings.equipment.handover.quantityType", "Quantity")
			: null,
		assignment.serialNumber
			? t("settings.equipment.detail.serial", "Serial {serial}", {
					serial: assignment.serialNumber,
				})
			: null,
	].filter(Boolean);
	return (
		<>
			<div className="px-4 lg:px-6">
				<BackLink href={back}>
					{t("settings.equipment.detail.back", "Back to equipment")}
				</BackLink>
			</div>
			<div className="flex flex-col gap-4 px-4 sm:flex-row sm:items-start sm:justify-between lg:px-6">
				<div className="flex min-w-0 items-center gap-3.5">
					<span
						aria-hidden="true"
						className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
					>
						<ItemIcon className="size-5" />
					</span>
					<div className="min-w-0 space-y-1">
						<div className="flex flex-wrap items-center gap-2.5">
							<h1
								className="break-words text-2xl font-semibold tracking-tight"
								translate="no"
							>
								{assignment.identifier}
							</h1>
							<AssignmentStatusBadge assignment={assignment} />
						</div>
						<p className="break-words text-sm text-muted-foreground">
							{detailLine.join(" · ")}
						</p>
					</div>
				</div>
				<AssignmentActions
					assignment={assignment}
					transferable={transferable}
					pending={pending}
					open={open}
				/>
			</div>
			<div className="grid items-start gap-6 px-4 lg:px-6 @5xl/main:grid-cols-[minmax(0,1fr)_20rem]">
				<div className="flex min-w-0 flex-col gap-6">
					<AssignmentFacts
						assignment={assignment}
						today={data.today}
						timezone={data.timezone}
					/>
					<Card className="gap-4">
						<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
							<h2 className="font-semibold leading-none">
								{t("settings.equipment.custody.history", "Handover history")}
							</h2>
							<CorrectionMenu
								assignment={correctable}
								disabled={pending}
								onSelect={(target) =>
									open({
										kind: "correction",
										assignmentId: assignment.id,
										target,
									})
								}
							/>
						</CardHeader>
						<CardContent>
							<EquipmentHistory
								assignment={assignment}
								timezone={data.timezone}
								today={data.today}
								pending={pending}
								onReceiveException={
									data.canManage
										? (exceptionId) =>
												open({
													kind: "exception_receipt",
													assignmentId: assignment.id,
													exceptionId,
												})
										: undefined
								}
							/>
						</CardContent>
					</Card>
					{corrections.length ? (
						<AmendmentsCard
							corrections={corrections}
							timezone={data.timezone}
						/>
					) : null}
				</div>
				<div className="flex min-w-0 flex-col gap-4">
					<Card className="gap-3">
						<CardContent className="space-y-3">
							<p className="text-xs text-muted-foreground">
								{t("settings.equipment.filters.holder", "Holder")}
							</p>
							<HolderIdentity
								employeeId={assignment.employeeId}
								name={assignment.holderName}
								image={assignment.holderImage}
								former={assignment.former}
								size="md"
								href={
									data.canManage
										? `/equipment/employees/${assignment.employeeId}`
										: undefined
								}
							/>
						</CardContent>
					</Card>
					<EquipmentRetention
						key={`retention:${assignment.id}:${assignment.revision}`}
						assignment={assignment}
						timezone={data.timezone}
						canAdminister={data.canManage && data.canAdminister}
						pending={pending}
						submit={submit}
					/>
				</div>
			</div>
			{panel}
		</>
	);
}
