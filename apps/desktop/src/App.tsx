import { useState } from "react";
import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { invoke } from "@tauri-apps/api/core";
import { IconSettings, IconWifiOff, IconClock } from "@tabler/icons-react";
import { Toaster, toast } from "sonner";
import { ClockButton } from "./components/ClockButton";
import { ClockRecoveryNotice } from "./components/ClockRecoveryNotice";
import { DayTotal } from "./components/DayTotal";
import { UpdateNotice } from "./components/UpdateCheck";
import { IdleDialog } from "./components/IdleDialog";
import { LoginScreen } from "./components/LoginScreen";
import { OrganizationSelector } from "./components/OrganizationSelector";
import { Settings } from "./components/Settings";
import { ThemeToggle } from "./components/ThemeToggle";
import { WorkLocationSelector } from "./components/WorkLocationSelector";
import { useAuth } from "./hooks/useAuth";
import { useClock } from "./hooks/useClock";
import { useIdle } from "./hooks/useIdle";
import { useOrganizations } from "./hooks/useOrganizations";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { useWorkLocation } from "./hooks/useWorkLocation";
import { LocaleProvider, resolveLanguage, useI18n } from "./lib/i18n";
import type {
	AttributionIntent,
	ClockCommandOutcome,
	DesktopContext,
} from "./types";
const queryClient = new QueryClient({
	defaultOptions: { queries: { retry: 1, staleTime: 10000 } },
});
function AppContent() {
	const auth = useAuth(),
		preferences = useSettings();
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
	const attribution = useForm({
		defaultValues: { project: "preserve", workCategory: "preserve" },
	});
	const intent = (value: string): AttributionIntent =>
		value === "preserve"
			? { kind: "preserve" }
			: value === "clear"
				? { kind: "clear" }
				: { kind: "replace", id: value };
	const closing = () => ({
		project: intent(attribution.state.values.project),
		workCategory: intent(attribution.state.values.workCategory),
	});
	const busy =
		clock.isClockingIn ||
		clock.isClockingOut ||
		endingDay ||
		organizations.isSwitching;
	const present = async (
		action: () => Promise<ClockCommandOutcome>,
		success: string,
	) => {
		try {
			const result = await action();
			if (result.outcome === "savedOnDevice")
				toast.info(t("Saved on this device"));
			else if (
				result.outcome === "needsReview" ||
				result.outcome === "retainedForReview"
			)
				toast.warning(t("Saved work needs review"), {
					description: t(
						"Check your time entries in Z8 before recording replacement work.",
					),
				});
			else
				toast.success(
					t(result.write.contextChanged ? "Previous context updated" : success),
				);
			return true;
		} catch (error) {
			toast.error(t("Clock action failed"), {
				description: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};
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
					<header className="app-header">
						<div className="app-header-left">
							<div className="app-header-brand">
								<div className="app-logo">
									<IconClock size={18} aria-hidden="true" />
								</div>
								<div>
									<div className="app-title">z8 Timer</div>
									<div className="app-subtitle">{t("Time tracking")}</div>
								</div>
							</div>
							<OrganizationSelector
								organizations={organizations.organizations}
								activeOrganizationId={organizations.activeOrganizationId}
								onSwitch={organizations.switchOrganization}
								isSwitching={busy || organizations.isOffline}
							/>
						</div>
						<div className="app-header-actions">
							{clock.isError && (
								<div className="offline-badge">
									<IconWifiOff size={14} aria-hidden="true" />
									<span>{t("Offline")}</span>
								</div>
							)}
							<ThemeToggle {...theme} />
							<button
								type="button"
								className="settings-button"
								onClick={() => setIsSettingsOpen(true)}
								disabled={busy}
								aria-label={t("Open settings")}
							>
								<IconSettings size={18} aria-hidden="true" />
							</button>
						</div>
					</header>
					<main className="app-main">
						{organizations.error && (
							<p role="alert">
								{t("Organization could not be loaded")}: {organizations.error}
							</p>
						)}
						{clock.journal && !clock.journal.busy &&
							(!clock.journal.commandsEnabled ||
								!clock.journal.breaksEnabled) && (
								<section className="clock-recovery">
									<strong>{t("Server setup required")}</strong>
									<p>
										{t(
											"Ask your administrator to enable reliable offline clocking and atomic breaks for this organization.",
										)}
									</p>
								</section>
							)}
						<UpdateNotice onOpen={() => setIsSettingsOpen(true)} />
						{contextError && <p role="alert" className="login-error">
                            {t("Day summary could not be loaded")}: {contextError}
                            <button type="button" className="clock-recovery-action" onClick={onRefreshContext}>{t("Retry")}</button>
                        </p>}
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
								await present(
									() => clock.clockIn(location.workLocationType),
									"Clock in",
								);
							}}
							onClockOut={async () => {
								await present(() => clock.clockOut(closing()), "Clock out");
							}}
							onStartBreak={async () => {
								await present(() => clock.startBreak(closing()), "On break");
							}}
							onEndDay={endDay}
							isLoading={busy}
							disabled={!clock.canClock}
						/>
						{context && clock.isClockedIn && (
							<div className="attribution-fields">
								<p className="field-hint">{t("Applied when work ends")}</p>
								<attribution.Field name="project">
									{(field) => (
										<label className="form-field">
											{t("Project")}
											<select
												value={field.state.value}
												disabled={busy}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
											>
												<option value="preserve">
													{t("Keep current assignment")}
												</option>
												<option value="clear">{t("No assignment")}</option>
												{context.projects.map((project) => (
													<option key={project.id} value={project.id}>
														{project.name}
													</option>
												))}
											</select>
										</label>
									)}
								</attribution.Field>
								<attribution.Field name="workCategory">
									{(field) => (
										<label className="form-field">
											{t("Work category")}
											<select
												value={field.state.value}
												disabled={busy}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
											>
												<option value="preserve">
													{t("Keep current assignment")}
												</option>
												<option value="clear">{t("No assignment")}</option>
												{context.categories.map((category) => (
													<option key={category.id} value={category.id}>
														{category.name}
													</option>
												))}
											</select>
										</label>
									)}
								</attribution.Field>
							</div>
						)}
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
						<div className="webapp-links">
							<button
								type="button"
								className="clock-recovery-action"
								onClick={() => openZ8("time")}
								disabled={busy}
							>
								{t("Time entries and corrections")}
							</button>
							<button
								type="button"
								className="clock-recovery-action"
								onClick={() => openZ8("reports")}
								disabled={busy}
							>
								{t("Reports")}
							</button>
						</div>
					</main>
					<footer className="app-footer">
						<div
							className={`status-badge ${clock.isClockedIn ? "status-active" : "status-inactive"}`}
						>
							<span className="status-dot" />
							<span>
								{t(
									onBreak
										? "On break"
										: clock.isClockedIn
											? "Currently working"
											: clock.isStatusCurrent || clock.journal?.projection
												? "Not clocked in"
												: "Clock status unavailable",
								)}
							</span>
						</div>
					</footer>
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
			{preferences.error && <p role="alert" className="login-error">
                {t("Preferences could not be loaded")}: {preferences.error}
                <button type="button" className="clock-recovery-action" onClick={() => void preferences.refetch()}>{t("Retry")}</button>
            </p>}
            {settings?.runtimeErrors?.map((message) => (
				<p key={message} role="alert" className="login-error">
					{message}
				</p>
			))}
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
