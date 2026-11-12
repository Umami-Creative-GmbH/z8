"use client";
import { useTranslate } from "@tolgee/react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { EQUIPMENT_REFUSALS } from "@/components/settings/equipment/equipment-refusals";
import { ActionPanel, ActionPanelContent } from "@/components/ui/action-panel";
import { changeEquipment } from "@/lib/organization/equipment/actions";
import type {
	EquipmentAssignmentView,
	EquipmentChange,
	EquipmentView,
} from "@/lib/organization/equipment/contracts";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { useRouter } from "@/navigation";
import {
	CorrectionEditor,
	type CorrectionTarget,
} from "./equipment-corrections";
import { CloseReturnForm, ReceiveExceptionForm } from "./equipment-exceptions";
import {
	HistoricalEquipmentForm,
	IssueEquipmentForm,
	ReceiveEquipmentForm,
	type SubmitHandover,
} from "./equipment-handovers";
import { TransferEquipmentForm } from "./equipment-transfer";

type Translate = ReturnType<typeof useTranslate>["t"];

function savedMessage(kind: EquipmentChange["kind"], t: Translate) {
	switch (kind) {
		case "place_case_hold":
		case "release_case_hold":
			return t("settings.equipment.retention.saved", "Case hold updated.");
		case "correct_issue":
		case "correct_receipt":
		case "correct_exception":
		case "correct_transfer":
			return t("settings.equipment.correction.saved", "Amendment recorded.");
		case "close_return":
		case "receive_exception":
			return t(
				"settings.equipment.exception.saved",
				"Equipment action recorded.",
			);
		default:
			return t("settings.equipment.handover.saved", "Handover recorded.");
	}
}

/**
 * Runs one equipment command: the outcome is a toast, and a recorded command
 * refreshes the server read. It resolves `true` only when the command was recorded,
 * so a refused or uncertain command leaves its form open with the same values (and
 * the same request identity) for review or retry.
 */
export function useEquipmentSubmit() {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const submit: SubmitHandover = useCallback(
		async (change) => {
			const failed = () =>
				toast.error(
					t(
						"settings.equipment.handover.failed",
						"The handover could not be confirmed. Retry the unchanged form or reload equipment to check its history.",
					),
				);
			setPending(true);
			// No `finally`: React Compiler cannot lower it.
			let recorded = false;
			try {
				const result = await changeEquipment(change);
				if (!result.success) {
					failed();
				} else if (!result.data.ok) {
					toast.error(actionErrorMessage(t, { refusal: result.data.reason }, EQUIPMENT_REFUSALS));
				} else {
					toast.success(savedMessage(change.kind, t));
					router.refresh();
					recorded = true;
				}
			} catch {
				failed();
			}
			setPending(false);
			return recorded;
		},
		[router, t],
	);
	return { submit, pending };
}

export type EquipmentPanelSelection =
	| { kind: "issue"; employeeId?: string }
	| { kind: "historical"; employeeId?: string }
	| { kind: "receipt"; assignmentId: string }
	| { kind: "transfer"; assignmentId: string }
	| { kind: "closure"; assignmentId: string }
	| { kind: "exception_receipt"; assignmentId: string; exceptionId: string }
	| { kind: "correction"; assignmentId: string; target: CorrectionTarget };

/** Whether the reader may transfer this assignment to someone else in scope. */
export function canTransfer(
	data: EquipmentView,
	assignment: EquipmentAssignmentView,
) {
	return (
		data.canManage &&
		!!assignment.transfer &&
		data.employees.some(
			(employee) =>
				!employee.former &&
				employee.canIssue !== false &&
				employee.id !== assignment.employeeId,
		)
	);
}

/** Issuance needs setup, retention and something to issue; former employees only get historical records. */
export function issuanceAvailability(data: EquipmentView, employeeId?: string) {
	const employee = employeeId
		? data.employees.find((candidate) => candidate.id === employeeId)
		: undefined;
	const canRecordHistorical =
		data.canManage &&
		data.policyConfigured &&
		(data.availableItems.length > 0 ||
			data.availableQuantityTypes.length > 0 ||
			data.registrationTypes.length > 0) &&
		(!employeeId || !!employee);
	const canIssue =
		canRecordHistorical &&
		(!employeeId ||
			(employee?.former === false && employee.canIssue !== false));
	return { canIssue, canRecordHistorical, employee };
}

/**
 * One action panel for every assignment form of a page. `open` picks the form;
 * a recorded command closes it and the page reloads its read.
 */
export function useEquipmentPanels(data: EquipmentView) {
	const { submit, pending } = useEquipmentSubmit();
	const [selection, setSelection] = useState<EquipmentPanelSelection | null>(
		null,
	);
	// Keep the closing form on screen while the panel animates out.
	const [shown, setShown] = useState(selection);
	if (selection && selection !== shown) setShown(selection);
	const close = useCallback(() => setSelection(null), []);
	const run: SubmitHandover = useCallback(
		async (change) => {
			const saved = await submit(change);
			if (saved) setSelection(null);
			return saved;
		},
		[submit],
	);
	const panel = (
		<ActionPanel
			open={!!selection}
			onOpenChange={(open) => {
				if (!open && !pending) close();
			}}
		>
			<ActionPanelContent size={shown ? panelSize(shown) : "default"}>
				{shown ? (
					<PanelForm
						data={data}
						selection={shown}
						submit={run}
						pending={pending}
						onCancel={close}
					/>
				) : null}
			</ActionPanelContent>
		</ActionPanel>
	);
	return { open: setSelection, panel, pending, submit };
}

function panelSize(selection: EquipmentPanelSelection) {
	switch (selection.kind) {
		case "receipt":
		case "closure":
		case "exception_receipt":
			return "compact" as const;
		default:
			return "default" as const;
	}
}

type PanelActions = {
	submit: SubmitHandover;
	pending: boolean;
	onCancel: () => void;
};

type IssuanceSelection = Extract<
	EquipmentPanelSelection,
	{ kind: "issue" | "historical" }
>;
type AssignmentSelection = Exclude<EquipmentPanelSelection, IssuanceSelection>;

function PanelForm({
	data,
	selection,
	submit,
	pending,
	onCancel,
}: PanelActions & {
	data: EquipmentView;
	selection: EquipmentPanelSelection;
}) {
	const actions = { submit, pending, onCancel };
	if (selection.kind === "issue" || selection.kind === "historical")
		return (
			<IssuancePanelForm data={data} selection={selection} actions={actions} />
		);
	return (
		<AssignmentPanelForm data={data} selection={selection} actions={actions} />
	);
}

/** Issuing or recording a historical handover, when the reader still may. */
function IssuancePanelForm({
	data,
	selection,
	actions,
}: {
	data: EquipmentView;
	selection: IssuanceSelection;
	actions: PanelActions;
}) {
	const { canIssue, canRecordHistorical } = issuanceAvailability(
		data,
		selection.employeeId,
	);
	const issuanceKey = [...data.availableItems, ...data.availableQuantityTypes]
		.map((item) => `${item.id}:${item.revision}`)
		.join(",");
	if (selection.kind === "issue")
		return canIssue ? (
			<IssueEquipmentForm
				key={issuanceKey}
				data={data}
				employeeId={selection.employeeId}
				{...actions}
			/>
		) : null;
	return canRecordHistorical ? (
		<HistoricalEquipmentForm
			key={issuanceKey}
			data={data}
			employeeId={selection.employeeId}
			{...actions}
		/>
	) : null;
}

/** A command on one assignment, when it still offers that command. */
function AssignmentPanelForm({
	data,
	selection,
	actions,
}: {
	data: EquipmentView;
	selection: AssignmentSelection;
	actions: PanelActions;
}) {
	const assignment = data.assignments.find(
		(candidate) => candidate.id === selection.assignmentId,
	);
	if (!assignment) return null;
	const key = `${assignment.id}:${assignment.revision}`;
	switch (selection.kind) {
		case "receipt":
			return assignment.canReceive ? (
				<ReceiveEquipmentForm
					key={key}
					assignment={assignment}
					timezone={data.timezone}
					today={data.today}
					{...actions}
				/>
			) : null;
		case "transfer":
			return canTransfer(data, assignment) ? (
				<TransferEquipmentForm
					key={`${key}:${assignment.transfer?.expectedIssuanceRevision}`}
					assignment={assignment}
					data={data}
					{...actions}
				/>
			) : null;
		case "closure":
			return assignment.canCloseException ? (
				<CloseReturnForm key={key} assignment={assignment} {...actions} />
			) : null;
		case "exception_receipt":
			return (
				<ExceptionReceiptPanelForm
					data={data}
					assignment={assignment}
					exceptionId={selection.exceptionId}
					actions={actions}
				/>
			);
		case "correction":
			return (
				<CorrectionEditor
					assignment={{
						...assignment,
						canCorrect: data.canManage && assignment.canCorrect,
						canCorrectReceipt: data.canManage && assignment.canCorrectReceipt,
						canCorrectException:
							data.canManage && assignment.canCorrectException,
					}}
					selection={selection.target}
					today={data.today}
					{...actions}
				/>
			);
	}
}

/** Receiving a return exception's items, while that exception can still receive. */
function ExceptionReceiptPanelForm({
	data,
	assignment,
	exceptionId,
	actions,
}: {
	data: EquipmentView;
	assignment: EquipmentAssignmentView;
	exceptionId: string;
	actions: PanelActions;
}) {
	const exception = assignment.exceptions.find(
		(candidate) => candidate.id === exceptionId && candidate.canReceive,
	);
	return exception ? (
		<ReceiveExceptionForm
			key={`${assignment.id}:${assignment.revision}:${exception.id}`}
			assignment={assignment}
			exception={exception}
			today={data.today}
			timezone={data.timezone}
			{...actions}
		/>
	) : null;
}
