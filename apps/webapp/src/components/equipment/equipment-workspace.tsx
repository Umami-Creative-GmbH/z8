"use client";
import { IconPackage, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { type ReactNode, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { parseInstant, parsePlainDate } from "@/lib/datetime/temporal-core";
import { changeEquipment } from "@/lib/organization/equipment/actions";
import type {
	EquipmentAssignmentView,
	EquipmentChange,
	EquipmentFilters,
	EquipmentHandoverView,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { Link, useRouter } from "@/navigation";
import { conditionLabel, handoverRefusalMessage } from "./equipment-copy";
import {
	equipmentSelectClass,
	IssueEquipmentForm,
	ReceiveEquipmentForm,
} from "./equipment-handovers";
import { EquipmentReadiness } from "./equipment-readiness";

export function EquipmentOverview({
	data,
	filters,
}: {
	data: EquipmentView;
	filters: EquipmentFilters;
}) {
	const { t } = useTranslate();
	return (
		<EquipmentWorkspace data={data} scope={{ kind: "overview" }}>
			<EquipmentFiltersForm
				key={JSON.stringify(filters)}
				data={data}
				filters={filters}
			/>
			{data.canAdminister ? (
				<Link
					className="text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					href="/settings/equipment"
				>
					{t(
						"settings.equipment.manageSetup",
						"Manage types, item identities and retention",
					)}
				</Link>
			) : null}
			{data.canManage ? (
				<EquipmentReadiness
					items={data.readinessItems ?? []}
					timezone={data.timezone}
				/>
			) : null}
		</EquipmentWorkspace>
	);
}
export function EmployeeEquipment({
	data,
	employeeId,
}: {
	data: EquipmentView;
	employeeId: string;
}) {
	return (
		<EquipmentWorkspace data={data} scope={{ kind: "employee", employeeId }} />
	);
}
export function PersonalEquipment({ data }: { data: EquipmentView }) {
	return <EquipmentWorkspace data={data} scope={{ kind: "personal" }} />;
}
type EquipmentScope =
	| { kind: "overview" }
	| { kind: "employee"; employeeId: string }
	| { kind: "personal" };
type HandoverSelection =
	| { kind: "issue" }
	| { kind: "receipt"; assignmentId: string }
	| null;

function useEquipmentCommands() {
	const { t } = useTranslate();
	const router = useRouter();
	const [selection, setSelection] = useState<HandoverSelection>(null);
	const [feedback, setFeedback] = useState<{
		kind: "error" | "success";
		text: string;
	} | null>(null);
	const [pending, startTransition] = useTransition();
	async function submit(change: EquipmentChange) {
		startTransition(async () => {
			setFeedback(null);
			try {
				const result = await changeEquipment(change);
				if (!result.success) {
					setFeedback({
						kind: "error",
						text: t(
							"settings.equipment.handover.failed",
							"The handover could not be confirmed. Retry the unchanged form or reload equipment to check its history.",
						),
					});
					return;
				}
				if (!result.data.ok) {
					setFeedback({
						kind: "error",
						text: handoverRefusalMessage(result.data.reason, t),
					});
					return;
				}
				setSelection(null);
				setFeedback({
					kind: "success",
					text: t("settings.equipment.handover.saved", "Handover recorded."),
				});
				router.refresh();
			} catch {
				setFeedback({
					kind: "error",
					text: t(
						"settings.equipment.handover.failed",
						"The handover could not be confirmed. Retry the unchanged form or reload equipment to check its history.",
					),
				});
			}
		});
	}
	return {
		selection,
		setSelection,
		feedback,
		setFeedback,
		pending,
		startTransition,
		submit,
		router,
	};
}

function equipmentSelection(
	data: EquipmentView,
	scope: EquipmentScope,
	selection: HandoverSelection,
) {
	const currentEmployee =
		scope.kind === "employee"
			? data.employees.find((employee) => employee.id === scope.employeeId)
			: undefined;
	const canIssue =
		data.canManage &&
		data.policyConfigured &&
		(data.availableItems.length > 0 || data.registrationTypes.length > 0) &&
		(scope.kind !== "employee" || currentEmployee?.former === false);
	const selectedReceipt =
		selection?.kind === "receipt"
			? data.assignments.find(
					(assignment) =>
						assignment.id === selection.assignmentId && assignment.canReceive,
				)
			: undefined;
	const unavailableReason =
		data.canManage && !canIssue
			? currentEmployee?.former
				? "former"
				: "setup"
			: null;
	return { canIssue, selectedReceipt, unavailableReason } as const;
}

function EquipmentWorkspace({
	data,
	scope,
	children,
}: {
	data: EquipmentView;
	scope: EquipmentScope;
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	const {
		selection,
		setSelection,
		feedback,
		setFeedback,
		pending,
		startTransition,
		submit,
		router,
	} = useEquipmentCommands();
	const { canIssue, selectedReceipt, unavailableReason } = equipmentSelection(
		data,
		scope,
		selection,
	);
	return (
		<section
			className="min-w-0 space-y-4"
			aria-label={t("settings.equipment.title", "Equipment")}
		>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<h2 className="flex items-center gap-2 text-lg font-semibold">
						<IconPackage
							className="size-5 text-muted-foreground"
							aria-hidden="true"
						/>
						{scope.kind === "personal"
							? t("settings.equipment.personal.title", "My equipment")
							: t("settings.equipment.title", "Equipment")}
					</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{t(
							"settings.equipment.custody.description",
							"Who holds each item, what must come back, and the recorded handover history.",
						)}
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						disabled={pending}
						onClick={() => startTransition(() => router.refresh())}
					>
						<IconRefresh className="size-4" aria-hidden="true" />
						{t("settings.equipment.custody.reload", "Reload equipment")}
					</Button>
					{canIssue ? (
						<Button
							disabled={pending || !!selection}
							onClick={() => {
								setFeedback(null);
								setSelection({ kind: "issue" });
							}}
						>
							<IconPlus className="size-4" aria-hidden="true" />
							{t("settings.equipment.custody.issue", "Issue equipment")}
						</Button>
					) : null}
				</div>
			</div>
			{children}
			{feedback ? (
				<p
					role={feedback.kind === "error" ? "alert" : "status"}
					className={
						feedback.kind === "error"
							? "text-sm text-destructive"
							: "text-sm text-muted-foreground"
					}
				>
					{feedback.text}
				</p>
			) : null}
			{pending ? (
				<p role="status" className="text-sm text-muted-foreground">
					{t("settings.equipment.custody.updating", "Updating equipment…")}
				</p>
			) : null}
			{selection?.kind === "issue" && canIssue ? (
				<IssueEquipmentForm
					key={data.availableItems
						.map((item) => `${item.id}:${item.revision}`)
						.join(",")}
					data={data}
					employeeId={scope.kind === "employee" ? scope.employeeId : undefined}
					submit={submit}
					pending={pending}
					onCancel={() => setSelection(null)}
				/>
			) : null}
			{selectedReceipt ? (
				<ReceiveEquipmentForm
					key={`${selectedReceipt.id}:${selectedReceipt.revision}`}
					assignment={selectedReceipt}
					timezone={data.timezone}
					today={data.today}
					submit={submit}
					pending={pending}
					onCancel={() => setSelection(null)}
				/>
			) : null}
			<EquipmentAssignments
				data={data}
				pending={pending || !!selection}
				onReceive={(assignmentId) => {
					setFeedback(null);
					setSelection({ kind: "receipt", assignmentId });
				}}
			/>
			<IssuanceAvailability reason={unavailableReason} />
		</section>
	);
}

function EquipmentAssignments({
	data,
	pending,
	onReceive,
}: {
	data: EquipmentView;
	pending: boolean;
	onReceive: (assignmentId: string) => void;
}) {
	const { t } = useTranslate();
	if (!data.assignments.length)
		return (
			<p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
				{t(
					"settings.equipment.custody.empty",
					"No equipment assignments match this view.",
				)}
			</p>
		);
	return (
		<div className="space-y-3">
			{data.assignments.map((assignment) => (
				<EquipmentAssignmentCard
					key={assignment.id}
					assignment={assignment}
					timezone={data.timezone}
					staff={data.canManage}
					receiptAction={
						assignment.canReceive ? (
							<Button
								variant="outline"
								disabled={pending}
								onClick={() => onReceive(assignment.id)}
							>
								{t("settings.equipment.handover.receive", "Record receipt")}
							</Button>
						) : null
					}
				/>
			))}
		</div>
	);
}
function IssuanceAvailability({
	reason,
}: {
	reason: "former" | "setup" | null;
}) {
	const { t } = useTranslate();
	if (!reason) return null;
	return (
		<p className="text-sm text-muted-foreground">
			{reason === "former"
				? t(
						"settings.equipment.custody.formerHelp",
						"Former employees remain available for returns and history. New issuance is unavailable.",
					)
				: t(
						"settings.equipment.custody.noItems",
						"To issue equipment, configure retention and register an available individual item in Equipment settings.",
					)}
		</p>
	);
}

function EquipmentFiltersForm({
	data,
	filters,
}: {
	data: EquipmentView;
	filters: EquipmentFilters;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const form = useForm({
		defaultValues: {
			holderId: filters.holderId ?? "",
			typeId: filters.typeId ?? "",
			outstanding:
				filters.outstanding === undefined ? "" : String(filters.outstanding),
			overdue: filters.overdue === undefined ? "" : String(filters.overdue),
			former: filters.former === undefined ? "" : String(filters.former),
		},
		onSubmit: ({ value }) => {
			const query = new URLSearchParams(
				Object.entries(value).filter(([, value]) => value !== ""),
			);
			router.replace(`/equipment${query.size ? `?${query}` : ""}`);
		},
	});
	const labels = {
		holderId: t("settings.equipment.filters.holder", "Holder"),
		typeId: t("settings.equipment.filters.type", "Type"),
		outstanding: t(
			"settings.equipment.filters.outstanding",
			"Outstanding returns",
		),
		overdue: t("settings.equipment.filters.overdue", "Overdue returns"),
		former: t("settings.equipment.filters.former", "Former employees"),
	};
	return (
		<form
			className="grid min-w-0 gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-3"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			{(
				["holderId", "typeId", "outstanding", "overdue", "former"] as const
			).map((name) => (
				<form.Field key={name} name={name}>
					{(field) => (
						<TFormItem>
							<TFormLabel>{labels[name]}</TFormLabel>
							<TFormControl>
								<select
									className={equipmentSelectClass}
									aria-label={labels[name]}
									name={name}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
								>
									<option value="">
										{t("settings.equipment.filters.all", "All")}
									</option>
									{name === "holderId" ? (
										data.employees.map((employee) => (
											<option key={employee.id} value={employee.id}>
												{employee.name}
												{employee.former
													? ` · ${t("settings.equipment.custody.former", "Former employee")}`
													: ""}
											</option>
										))
									) : name === "typeId" ? (
										data.types.map((type) => (
											<option key={type.id} value={type.id}>
												{type.name}
											</option>
										))
									) : (
										<>
											<option value="true">{t("common.yes", "Yes")}</option>
											<option value="false">{t("common.no", "No")}</option>
										</>
									)}
								</select>
							</TFormControl>
						</TFormItem>
					)}
				</form.Field>
			))}
			<div className="flex items-end">
				<Button type="submit" variant="outline">
					{t("settings.equipment.filters.apply", "Apply filters")}
				</Button>
			</div>
		</form>
	);
}

function EquipmentAssignmentCard({
	assignment,
	timezone,
	staff,
	receiptAction,
}: {
	assignment: EquipmentAssignmentView;
	timezone: string;
	staff: boolean;
	receiptAction: ReactNode;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const date = (value: string) =>
		parsePlainDate(value).toLocaleString(locale, { dateStyle: "medium" });
	return (
		<article className="min-w-0 space-y-4 rounded-lg border bg-card p-4 [content-visibility:auto]">
			<div className="flex flex-wrap justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<h3 className="break-words font-semibold">
						<span translate="no">{assignment.identifier}</span> ·{" "}
						{assignment.typeName}
					</h3>
					<p className="break-words text-sm">
						{staff ? (
							<Link
								className="text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
								href={`/equipment/employees/${assignment.employeeId}`}
							>
								{assignment.holderName}
							</Link>
						) : (
							assignment.holderName
						)}
					</p>
					{assignment.former ? (
						<Badge variant="outline">
							{t("settings.equipment.custody.former", "Former employee")}
						</Badge>
					) : null}
				</div>
				<div className="flex flex-wrap items-start gap-2">
					<Badge variant={assignment.overdue ? "destructive" : "secondary"}>
						{assignment.receipt
							? t("settings.equipment.custody.received", "Physically received")
							: assignment.overdue
								? t("settings.equipment.custody.overdue", "Overdue")
								: assignment.outstanding
									? t(
											"settings.equipment.custody.outstanding",
											"Outstanding return",
										)
									: t("settings.equipment.custody.keep", "Issued to keep")}
					</Badge>
					{receiptAction}
				</div>
			</div>
			<dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
				<div>
					<dt className="text-muted-foreground">
						{t("settings.equipment.custody.agreement", "Agreed return terms")}
					</dt>
					<dd>
						{assignment.returnRequired
							? t(
									"settings.equipment.handover.returnRequired",
									"Return required",
								)
							: t("settings.equipment.custody.keep", "Issued to keep")}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t("settings.equipment.custody.custody", "Physical custody")}
					</dt>
					<dd>
						{assignment.held
							? t("settings.equipment.custody.held", "Held by employee")
							: t("settings.equipment.custody.received", "Physically received")}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t(
							"settings.equipment.custody.deadline",
							"Explicit return deadline",
						)}
					</dt>
					<dd>
						{assignment.explicitDeadline ? (
							<time dateTime={assignment.explicitDeadline}>
								{date(assignment.explicitDeadline)}
							</time>
						) : (
							t("settings.equipment.custody.noDeadline", "No explicit deadline")
						)}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground">
						{t(
							"settings.equipment.custody.latestCondition",
							"Latest recorded condition",
						)}
					</dt>
					<dd>
						{conditionLabel(
							assignment.receipt?.condition ?? assignment.issue.condition,
							t,
						)}
					</dd>
				</div>
			</dl>
			{assignment.receipt?.condition === "damaged" ? (
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.equipment.custody.damageHelp",
						"Return fulfilled. Damaged receipt requires separate clearance before reissue; see current item availability.",
					)}
				</p>
			) : null}
			<details className="border-t pt-3">
				<summary className="cursor-pointer text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring">
					{t("settings.equipment.custody.history", "Handover history")}
				</summary>
				<ol className="mt-3 space-y-4">
					<HandoverEvidence
						handover={assignment.issue}
						timezone={timezone}
						kind="issue"
					/>
					{assignment.receipt ? (
						<HandoverEvidence
							handover={assignment.receipt}
							timezone={timezone}
							kind="receipt"
						/>
					) : null}
				</ol>
			</details>
		</article>
	);
}
function HandoverEvidence({
	handover,
	timezone,
	kind,
}: {
	handover: EquipmentHandoverView;
	timezone: string;
	kind: "issue" | "receipt";
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	return (
		<li className="space-y-1 break-words text-sm">
			<p className="font-medium">
				{kind === "issue"
					? t("settings.equipment.custody.issuance", "Issuance")
					: t("settings.equipment.custody.receipt", "Physical receipt")}{" "}
				·{" "}
				<time dateTime={handover.actualDate}>
					{parsePlainDate(handover.actualDate).toLocaleString(locale, {
						dateStyle: "medium",
					})}
				</time>{" "}
				· {conditionLabel(handover.condition, t)}
			</p>
			<p className="text-muted-foreground">
				{t("settings.equipment.custody.recordedBy", "Recorded by")}{" "}
				<span>
					{handover.actorName ??
						t("settings.equipment.custody.removedActor", "Removed account")}
				</span>{" "}
				·{" "}
				<time dateTime={handover.recordedAt}>
					{parseInstant(handover.recordedAt)
						.toZonedDateTimeISO(timezone)
						.toLocaleString(locale, {
							dateStyle: "medium",
							timeStyle: "short",
						})}
				</time>{" "}
				<span translate="no">{timezone}</span>
			</p>
			{handover.notes ? (
				<p className="whitespace-pre-wrap">{handover.notes}</p>
			) : null}
		</li>
	);
}
