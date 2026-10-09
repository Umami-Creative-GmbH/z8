import { useEffect, useRef, useState } from "react";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { useClosingAttribution } from "./hooks/useClosingAttribution";
import { useClockFeedback } from "./hooks/useClockFeedback";
import { useClockTimezone } from "./hooks/useClockTimezone";
import { ClosingAttributionFields } from "./components/ClosingAttributionFields";
import { CompanionHeader } from "./components/CompanionHeader";
import { CompanionFooter } from "./components/CompanionFooter";
import { ServerSetupNotice } from "./components/ServerSetupNotice";
import { TimezoneDialog } from "./components/TimezoneDialog";
import { invoke } from "@tauri-apps/api/core";

import { Toaster, toast } from "sonner";
import { ClockButton } from "./components/ClockButton";
import { ClockRecoveryNotice } from "./components/ClockRecoveryNotice";
import { DayTotal } from "./components/DayTotal";
import { UpdateNotice } from "./components/UpdateCheck";
import { IdleDialog } from "./components/IdleDialog";
import { LoginScreen } from "./components/LoginScreen";

import { Settings } from "./components/Settings";

import { WorkLocationSelector } from "./components/WorkLocationSelector";
import { useAuth } from "./hooks/useAuth";
import { useClock } from "./hooks/useClock";
import { useIdle } from "./hooks/useIdle";
import { useOrganizations } from "./hooks/useOrganizations";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useWorkLocation } from "./hooks/useWorkLocation";
import { LocaleProvider, useI18n } from "./lib/i18n";
import { resolveLanguage } from "./lib/language";
import type { DesktopContext } from "./types";
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
});
function AppContent() {
	const auth = useAuth(),
		preferences = useSettings();
	const wasAuthenticated = useRef(auth.isAuthenticated);
	const { setIsSettingsOpen } = preferences;
	useEffect(() => {
		if (wasAuthenticated.current && !auth.isAuthenticated)
			setIsSettingsOpen(false);
		wasAuthenticated.current = auth.isAuthenticated;
	}, [auth.isAuthenticated, setIsSettingsOpen]);
	const organizations = useOrganizations({
		isAuthenticated: auth.isAuthenticated,
		sessionVersion: auth.sessionVersion,
		serverUrl: preferences.settings?.webappUrl,
	});
	const scope = JSON.stringify([
		auth.sessionVersion,
		preferences.settings?.webappUrl,
		organizations.activeOrganizationId,
	]);
	const context = useQuery({
		queryKey: ["desktop-context", scope],
		queryFn: async () => {
			const data = await invoke<DesktopContext>("get_desktop_context");
			if (data.organizationId !== organizations.activeOrganizationId) {
				void organizations.refetch();
				throw new Error("Organization context changed. Refresh status.");
			}
			return data;
		},
		enabled:
			auth.isAuthenticated &&
			!!organizations.activeOrganizationId &&
			!organizations.isSwitching,
		refetchInterval: 30000,
		refetchOnWindowFocus: true,
	});
	return (
		<LocaleProvider
			language={resolveLanguage(
				preferences.settings?.language,
				context.data?.locale,
			)}
		>
			<Companion
				key={scope}
				auth={auth}
				preferences={preferences}
				organizations={organizations}
				context={context.data}
				contextError={context.error ? String(context.error) : null}
				onRefreshContext={() => void context.refetch()}
				scope={scope}
			/>
		</LocaleProvider>
	);
}
function Companion({
	auth,
	preferences,
	organizations,
	context,
	contextError,
	onRefreshContext,
	scope,
}: {
	auth: ReturnType<typeof useAuth>;
	preferences: ReturnType<typeof useSettings>;
	organizations: ReturnType<typeof useOrganizations>;
	context: DesktopContext | undefined;
	contextError: string | null;
	onRefreshContext: () => void;
	scope: string;
}) {
	const { t, language } = useI18n();
	const { settings, isSettingsOpen, setIsSettingsOpen } = preferences;
	const clock = useClock({
		enabled:
			auth.isAuthenticated &&
			!!organizations.activeOrganizationId &&
			!organizations.isSwitching,
		sessionVersion: auth.sessionVersion,
		sessionRevision: auth.sessionRevision,
		serverUrl: settings?.webappUrl,
		organizationId: organizations.activeOrganizationId,
	});
	const { idleEvent, isIdleDialogOpen, dismissIdle } = useIdle();
	const theme = useTheme(),
		location = useWorkLocation(scope);
	const [processingIdle, setProcessingIdle] = useState(false),
		[endingDay, setEndingDay] = useState(false);
	const attribution = useClosingAttribution(context);
	const timezone = useClockTimezone(context?.timezone);
	const busy =
		clock.isClockingIn ||
		clock.isClockingOut ||
		endingDay ||
		organizations.isSwitching;
	const present = useClockFeedback();
	const endDay = async () => {
		if (endingDay) return;
		setEndingDay(true);
		try {
			await clock.endDay();
			toast.success(t("Day ended"));
		} catch (error) {
			toast.error(t("Clock action failed"), { description: String(error) });
		} finally {
			setEndingDay(false);
		}
	};
	const confirmIdle = async () => {
		if (!idleEvent || !clock.canRecordBreak || busy) return;
		setProcessingIdle(true);
		try {
			if (
				await present(
					() =>
						clock.clockOutWithBreak({
							breakId: idleEvent.id,
							workLocationType: location.workLocationType,
						}),
					"Break recorded",
				)
			)
				dismissIdle();
		} finally {
			setProcessingIdle(false);
		}
	};
	const continueWork = () => {
		if (idleEvent) void invoke("dismiss_idle_break", { breakId: idleEvent.id });
		dismissIdle();
	};
	const openZ8 = async (section: string) => {
		try {
			await invoke("open_webapp", { section, language });
		} catch (error) {
			toast.error(t("Could not open Z8"), { description: String(error) });
		}
	};
	const onBreak = clock.isOnBreak && !clock.isClockedIn;
	return (
		<>
			{!auth.isAuthenticated ? (
				<LoginScreen
					webappUrl={settings?.webappUrl ?? ""}
					authError={auth.authError}
					onLogin={auth.login}
					onOpenSettings={() => setIsSettingsOpen(true)}
				/>
			) : (
				<div className="app-container">
					<CompanionHeader
						organizations={organizations}
						theme={theme}
						busy={busy}
						offline={clock.isError}
						onOpenSettings={() => setIsSettingsOpen(true)}
						onOpenDashboard={() => void openZ8("dashboard")}
					/>
					<main className="app-main">
						{organizations.error && (
							<p role="alert">
								{t("Organization could not be loaded")}: {organizations.error}
							</p>
						)}
						<UpdateNotice onOpen={() => setIsSettingsOpen(true)} />
						{contextError && (
							<p role="alert" className="login-error">
								{t("Day summary could not be loaded")}: {contextError}
								<button
									type="button"
									className="clock-recovery-action"
									onClick={onRefreshContext}
								>
									{t("Retry")}
								</button>
							</p>
						)}
						<DayTotal context={context} journal={clock.journal} />
						{!clock.isClockedIn && (
							<WorkLocationSelector
								value={location.workLocationType}
								onChange={location.setWorkLocationType}
								disabled={busy}
							/>
						)}
						<ClockButton
							isClockedIn={clock.isClockedIn}
							isOnBreak={onBreak}
							startTime={clock.startTime}
							onClockIn={async () => {
								await timezone.run(() =>
									present(
										() => clock.clockIn(location.workLocationType),
										"Clock in",
									),
								);
							}}
							onClockOut={async () => {
								await timezone.run(() =>
									present(
										() => clock.clockOut(attribution.value(context)),
										"Clock out",
									),
								);
							}}
							onStartBreak={async () => {
								await timezone.run(() =>
									present(
										() => clock.startBreak(attribution.value(context)),
										"On break",
									),
								);
							}}
							onEndDay={endDay}
							isLoading={busy}
							disabled={!clock.canClock}
						/>
						{context && clock.isClockedIn && (
							<ClosingAttributionFields
								form={attribution.form}
								context={context}
								disabled={busy}
							/>
						)}
						<ServerSetupNotice journal={clock.journal} />
						<ClockRecoveryNotice
							journal={clock.journal}
							journalError={clock.journalError}
							actionError={clock.actionError}
							savedCommandError={clock.savedCommandError}
							needsStatusRefresh={clock.needsStatusRefresh}
							onRefresh={clock.refetch}
							onRetry={clock.retrySavedCommand}
							onArchive={clock.archiveSavedCommand}
							isUpdating={clock.isUpdatingSavedCommand}
						/>
					</main>
					<CompanionFooter
						onBreak={onBreak}
						isClockedIn={clock.isClockedIn}
						statusKnown={clock.isStatusCurrent || !!clock.journal?.projection}
					/>
					<IdleDialog
						isOpen={
							isIdleDialogOpen &&
							!!settings?.idleEnabled &&
							!busy &&
							!!organizations.activeOrganizationId
						}
						idleEvent={idleEvent}
						onBreak={confirmIdle}
						onResume={continueWork}
						isLoading={processingIdle}
						canRecord={clock.canRecordBreak}
					/>
				</div>
			)}
			{preferences.error && (
				<p role="alert" className="login-error">
					{t("Preferences could not be loaded")}: {preferences.error}
					<button
						type="button"
						className="clock-recovery-action"
						onClick={() => void preferences.refetch()}
					>
						{t("Retry")}
					</button>
				</p>
			)}
			{settings?.runtimeErrors?.map((message) => (
				<p key={message} role="alert" className="login-error">
					{message}
				</p>
			))}
			<TimezoneDialog
				deviceZone={timezone.deviceZone}
				savedZone={context?.timezone}
				onContinue={timezone.continueOnce}
				onCancel={timezone.cancel}
				onUpdate={async () => {
					timezone.cancel();
					await openZ8("preferences");
				}}
			/>
			<Settings
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
				settings={settings}
				onSave={preferences.saveSettings}
				onLogout={auth.logout}
				isSaving={preferences.isSaving}
				isAuthenticated={auth.isAuthenticated}
			/>
			<Toaster position="bottom-center" richColors />
		</>
	);
}
export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<AppContent />
		</QueryClientProvider>
	);
}
