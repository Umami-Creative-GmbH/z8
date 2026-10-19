"use client";

import { useTranslate } from "@tolgee/react";
import { formatKioskTime } from "@/lib/time-tracking/kiosk/display";
import type { KioskOfflineEmployeeView } from "@/lib/time-tracking/kiosk/offline-command";
import type {
	KioskDeviceInfo,
	KioskEmployeeListing,
	KioskEmployeeSnapshot,
} from "@/lib/time-tracking/kiosk/protocol";
import type { AttributionAnswer } from "./kiosk-attribution";
import { KioskAttributionStep } from "./kiosk-attribution-step";
import { KioskBadgeCheck } from "./kiosk-badge-check";
import { KioskCameraScan } from "./kiosk-camera-scan";
import { KioskConfirmation } from "./kiosk-confirmation";
import {
	KioskEmployeePanel,
	type KioskPanelAction,
	useKioskActionLabels,
} from "./kiosk-employee-panel";
import { useKioskRefusalMessage } from "./kiosk-messages";
import { KioskPinPad } from "./kiosk-pin-pad";
import { KIOSK_CONFIRMATION_MS } from "./kiosk-timing";
import {
	type KioskFlow,
	type KioskTurnConfirmation,
	type KioskTurnProof,
	type OfflineTurn,
	type VehicleAnswer,
	vehicleBackFlow,
} from "./kiosk-turn-flow";
import { KioskUncertainScreen } from "./kiosk-uncertain-screen";
import { KioskVehicleUseStep } from "./kiosk-vehicle-use-step";

/** The steps of an employee's turn the kiosk shows from what it keeps offline (#1291, #1292). */
type OfflineTurnFlow = Extract<KioskFlow, { step: "cached" | "offline" | "offline-vehicle" }>;

function isOfflineTurnFlow(flow: KioskFlow): flow is OfflineTurnFlow {
	return flow.step === "cached" || flow.step === "offline" || flow.step === "offline-vehicle";
}

/** The screen of an employee's turn, by its step (the home screen is the kiosk's own). */
export function KioskTurnScreen({
	flow,
	kiosk,
	online,
	locale,
	onFlow,
	onHome,
	onCameraBadge,
	onVerifyPin,
	onChoose,
	onProceed,
	onAct,
	onChooseOffline,
	onActOffline,
}: {
	flow: Exclude<KioskFlow, { step: "home" }>;
	kiosk: KioskDeviceInfo;
	online: boolean;
	locale: string;
	onFlow: (flow: KioskFlow) => void;
	onHome: () => void;
	/** A badge the camera step read (#1367). */
	onCameraBadge: (badge: string) => void;
	onVerifyPin: (employee: KioskEmployeeListing, attempt: number, pin: string) => void;
	onChoose: (
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
	) => void;
	/** The project and work category were answered (#887): what the action asks next. */
	onProceed: (
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		attribution: AttributionAnswer,
	) => void;
	onAct: (
		proof: KioskTurnProof,
		snapshot: KioskEmployeeSnapshot,
		action: KioskPanelAction,
		vehicle: VehicleAnswer,
		attribution?: AttributionAnswer,
	) => void;
	onChooseOffline: (turn: OfflineTurn, action: KioskPanelAction) => void;
	onActOffline: (turn: OfflineTurn, action: KioskPanelAction, vehicle: VehicleAnswer) => void;
}) {
	const message = useKioskRefusalMessage(kiosk.timezone, locale);
	const labels = useKioskActionLabels();

	if (isOfflineTurnFlow(flow)) {
		return (
			<KioskOfflineTurnScreen
				flow={flow}
				zone={kiosk.timezone}
				locale={locale}
				labels={labels}
				onFlow={onFlow}
				onHome={onHome}
				onChooseOffline={onChooseOffline}
				onActOffline={onActOffline}
			/>
		);
	}

	switch (flow.step) {
		case "pin":
			return (
				<KioskPinPad
					key={`pin-${flow.attempt}`}
					name={flow.employee.name}
					busy={flow.busy}
					disabled={!online && !kiosk.offlineMode}
					error={flow.error ? message(flow.error) : null}
					onSubmit={(pin) => onVerifyPin(flow.employee, flow.attempt, pin)}
					onBack={onHome}
				/>
			);
		case "camera":
			return (
				<KioskCameraScan
					key="camera"
					onBadge={onCameraBadge}
					onProblem={(problem) => onFlow({ step: "home", notice: { code: problem } })}
					onCancel={onHome}
				/>
			);
		case "badge":
			return <KioskBadgeCheck key="badge" />;
		case "employee":
			return (
				<KioskEmployeePanel
					key="employee"
					snapshot={flow.snapshot}
					zone={kiosk.timezone}
					locale={locale}
					pending={flow.pending}
					disabled={!online}
					error={flow.error ? message(flow.error) : null}
					onAction={(action) => onChoose(flow.proof, flow.snapshot, action)}
					onBack={onHome}
				/>
			);
		case "attribution":
			return (
				<KioskAttributionStep
					key="attribution"
					name={flow.snapshot.employee.name}
					attribution={flow.ask}
					values={flow.values}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={!online}
					error={flow.error ? message(flow.error) : null}
					onConfirm={(values) =>
						onProceed(flow.proof, flow.snapshot, flow.action, { ask: flow.ask, values })
					}
					onBack={() =>
						onFlow({
							step: "employee",
							proof: flow.proof,
							snapshot: flow.snapshot,
							pending: null,
							error: null,
						})
					}
				/>
			);
		case "vehicle":
			return (
				<KioskVehicleUseStep
					key="vehicle"
					question={flow.ask.question}
					snapshot={flow.snapshot}
					context={flow.ask.context}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={!online}
					onConfirm={(answer) =>
						onAct(
							flow.proof,
							flow.snapshot,
							flow.action,
							{ ask: flow.ask, answer },
							flow.attribution,
						)
					}
					onBack={() => onFlow(vehicleBackFlow(flow))}
				/>
			);
		case "uncertain":
			return (
				<KioskUncertainScreen
					key="uncertain"
					attempt={flow.attempt}
					actionLabel={labels.buttons[flow.attempt.action]}
					check={flow.check}
					onHome={onHome}
				/>
			);
		case "done":
			return (
				<KioskDoneScreen
					key="done"
					confirmation={flow.confirmation}
					locale={locale}
					labels={labels}
					onHome={onHome}
				/>
			);
	}
}

/** The steps of a turn from the kiosk's offline data: a cached state, or an offline action (#1292). */
function KioskOfflineTurnScreen({
	flow,
	zone,
	locale,
	labels,
	onFlow,
	onHome,
	onChooseOffline,
	onActOffline,
}: {
	flow: OfflineTurnFlow;
	zone: string;
	locale: string;
	labels: ReturnType<typeof useKioskActionLabels>;
	onFlow: (flow: KioskFlow) => void;
	onHome: () => void;
	onChooseOffline: (turn: OfflineTurn, action: KioskPanelAction) => void;
	onActOffline: (turn: OfflineTurn, action: KioskPanelAction, vehicle: VehicleAnswer) => void;
}) {
	const queuedNotice = useQueuedNotice();

	switch (flow.step) {
		case "cached":
			return (
				<KioskEmployeePanel
					key="cached"
					snapshot={{
						employee: { id: flow.employee.id, name: flow.employee.name },
						state: flow.employee.state,
						asOf: flow.employee.learnedAt,
					}}
					zone={zone}
					locale={locale}
					pending={null}
					disabled
					error={null}
					onAction={() => undefined}
					onBack={onHome}
				/>
			);
		case "offline":
			return (
				<KioskEmployeePanel
					key="offline"
					snapshot={{
						employee: flow.turn.view.employee,
						state: flow.turn.view.state,
						asOf: flow.turn.view.learnedAt,
					}}
					zone={zone}
					locale={locale}
					pending={flow.pending}
					disabled={false}
					error={flow.error}
					notice={queuedNotice(flow.turn.view)}
					onAction={(action) => onChooseOffline(flow.turn, action)}
					onBack={onHome}
				/>
			);
		case "offline-vehicle":
			return (
				<KioskVehicleUseStep
					key="offline-vehicle"
					question={flow.ask.question}
					snapshot={flow.turn.view}
					context={flow.ask.context}
					actionLabel={labels.buttons[flow.action]}
					pending={flow.pending}
					disabled={false}
					onConfirm={(answer) => onActOffline(flow.turn, flow.action, { ask: flow.ask, answer })}
					onBack={() =>
						onFlow({
							step: "offline",
							turn: flow.turn,
							pending: null,
							error: null,
						})
					}
				/>
			);
	}
}

/** What an offline employee panel notes about the state it shows (#1292). */
function useQueuedNotice() {
	const { t } = useTranslate();
	return (view: KioskOfflineEmployeeView) =>
		view.queued > 0
			? t(
					"timeTracking.kiosk.offline.stateQueued",
					"The kiosk is offline. This includes clockings saved on this kiosk that are not yet confirmed.",
				)
			: t(
					"timeTracking.kiosk.offline.stateNote",
					"The kiosk is offline. What you do now is saved on this kiosk and not yet confirmed.",
				);
}

function KioskDoneScreen({
	confirmation,
	locale,
	labels,
	onHome,
}: {
	confirmation: KioskTurnConfirmation;
	locale: string;
	labels: ReturnType<typeof useKioskActionLabels>;
	onHome: () => void;
}) {
	const { t } = useTranslate();
	return (
		<KioskConfirmation
			name={confirmation.name}
			action={labels.done[confirmation.action]}
			time={formatKioskTime(confirmation.at, confirmation.zone, locale)}
			note={
				confirmation.action === "end_day"
					? t("timeTracking.kiosk.done.endDayNote", "Your day ended at the start of your break.")
					: null
			}
			warning={
				confirmation.vehicleUseLeftOut
					? t("timeTracking.vehicleUse.notRecorded", "Vehicle use was not recorded")
					: null
			}
			unconfirmed={
				confirmation.unconfirmed
					? t(
							"timeTracking.kiosk.done.unconfirmed",
							"Saved on this kiosk, not yet confirmed. Your PIN is checked when the kiosk is back online.",
						)
					: null
			}
			returnsInMs={KIOSK_CONFIRMATION_MS}
			onHome={onHome}
		/>
	);
}
