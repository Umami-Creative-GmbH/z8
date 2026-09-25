import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  IconSettings,
  IconWifiOff,
  IconClock,
} from "@tabler/icons-react";
import { Toaster, toast } from "sonner";

import { ClockButton } from "./components/ClockButton";
import { ClockRecoveryNotice } from "./components/ClockRecoveryNotice";
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
import type { ClockCommandOutcome } from "./types";

function showClockOutcome(result: ClockCommandOutcome, successMessage: string) {
  if (result.outcome === "savedOnDevice") {
    toast.info("Clock action saved on this device", {
      description: "It is sent unchanged as soon as the server can accept it.",
    });
  } else if (result.outcome === "needsReview") {
    toast.warning("Clock action needs review", {
      description: "The server did not save it. The action stays on this device; check your time entries in Z8.",
    });
  } else if (result.outcome === "retainedForReview") {
    toast.warning("Clock outcome needs review", {
      description: "The local record was retained. Check your time entries in Z8 before recording replacement work.",
    });
  } else if (result.write.contextChanged) {
    toast.success("Clock action saved in the previous context", {
      description: "Refresh status for your current account and organization.",
    });
  } else if (result.write.statusRefreshFailed) {
    toast.success(successMessage, {
      description: "Saved. Current status is unavailable; refresh status before another action.",
    });
  } else {
    toast.success(successMessage);
  }
}

async function presentClockAction(action: () => Promise<ClockCommandOutcome>, successMessage: string) {
  try {
    showClockOutcome(await action(), successMessage);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}

function ClockStatusBadge({ isCurrent, isClockedIn }: { isCurrent: boolean; isClockedIn: boolean }) {
  const label = isCurrent
    ? (isClockedIn ? "Currently Working" : "Not Clocked In")
    : "Clock status unavailable";
  return (
    <div className={`status-badge ${isCurrent && isClockedIn ? "status-active" : "status-inactive"}`}>
      <div className="status-dot" />
      <span>{label}</span>
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

function AppContent() {
  const { isAuthenticated, login, logout, sessionVersion, isLoading: isAuthLoading } = useAuth();
  const {
    settings,
    saveSettings,
    isSaving,
    isSettingsOpen,
    setIsSettingsOpen,
  } = useSettings();
  const {
    organizations,
    activeOrganizationId,
    switchOrganization,
    isSwitching,
  } = useOrganizations();
  const {
    isClockedIn,
    startTime,
    clockIn,
    clockOut,
    clockOutWithBreak,
    isClockingIn,
    isClockingOut,
    isError,
    canClock,
    canRecordBreak,
    isStatusCurrent,
    needsStatusRefresh,
    actionError,
    journal,
    journalError,
    retrySavedCommand,
    archiveSavedCommand,
    isUpdatingSavedCommand,
    refetch,
  } = useClock({
    enabled: isAuthenticated,
    sessionVersion,
    serverUrl: settings?.webappUrl,
    organizationId: activeOrganizationId,
  });
  const { idleEvent, isIdleDialogOpen, dismissIdle } = useIdle();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { workLocationType, setWorkLocationType } = useWorkLocation();

  const [isProcessingIdle, setIsProcessingIdle] = useState(false);
  const isClockBusy = isClockingIn || isClockingOut;
  const areControlsBusy = isClockBusy || isSwitching;

  const handleClockIn = async () => {
    await presentClockAction(() => clockIn(workLocationType), "Clocked in successfully");
  };

  const handleClockOut = async () => {
    await presentClockAction(clockOut, "Clocked out successfully");
  };

  const handleIdleBreak = async () => {
    if (!idleEvent || !canRecordBreak || isSwitching) return;

    setIsProcessingIdle(true);
    try {
      const handled = await presentClockAction(() => clockOutWithBreak({
        breakStartTime: idleEvent.idleStartTime,
        workLocationType,
      }), "Break recorded, clocked back in");
      if (handled) dismissIdle();
    } finally {
      setIsProcessingIdle(false);
    }
  };

  const handleIdleResume = () => {
    dismissIdle();
    toast.info("Continuing work session");
  };

  // Show login screen if not authenticated
  if (!isAuthenticated && !isAuthLoading) {
    return (
      <>
        <LoginScreen
          webappUrl={settings?.webappUrl ?? ""}
          onLogin={login}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />
        <Settings
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          settings={settings}
          onSave={saveSettings}
          onLogout={logout}
          isSaving={isSaving}
          isAuthenticated={isAuthenticated}
        />
        <Toaster position="bottom-center" richColors />
      </>
    );
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-header-brand">
            <div className="app-logo">
              <IconClock size={18} color="white" aria-hidden="true" />
            </div>
            <div>
              <div className="app-title">z8 Timer</div>
              <div className="app-subtitle">Time tracking</div>
            </div>
          </div>
          {organizations.length > 0 && (
            <OrganizationSelector
              organizations={organizations}
              activeOrganizationId={activeOrganizationId}
              onSwitch={switchOrganization}
              isSwitching={areControlsBusy}
            />
          )}
        </div>
        <div className="app-header-actions">
          {isError && (
            <div className="offline-badge">
              <IconWifiOff size={14} aria-hidden="true" />
              <span>Offline</span>
            </div>
          )}
          <ThemeToggle theme={theme} setTheme={setTheme} resolvedTheme={resolvedTheme} labelPrefix="Change Theme" />
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            disabled={isClockBusy}
            className="settings-button"
            title="Settings"
            aria-label="Open Settings"
          >
            <IconSettings size={18} />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main">
        {!isClockedIn && (
          <WorkLocationSelector
            value={workLocationType}
            onChange={setWorkLocationType}
            disabled={areControlsBusy}
          />
        )}
        <ClockButton
          isClockedIn={isClockedIn}
          startTime={startTime}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          isLoading={isClockBusy}
          disabled={!canClock || isSwitching}
        />
        <ClockRecoveryNotice
          journal={journal}
          journalError={journalError}
          actionError={actionError}
          needsStatusRefresh={needsStatusRefresh}
          onRefresh={refetch}
          onRetry={retrySavedCommand}
          onArchive={archiveSavedCommand}
          isUpdating={isUpdatingSavedCommand}
        />
      </main>

      {/* Footer status */}
      <footer className="app-footer">
        <ClockStatusBadge isCurrent={isStatusCurrent} isClockedIn={isClockedIn} />
      </footer>

      {/* Idle Dialog */}
      <IdleDialog
        isOpen={isIdleDialogOpen && canRecordBreak && !isSwitching}
        idleEvent={idleEvent}
        onBreak={handleIdleBreak}
        onResume={handleIdleResume}
        isLoading={isProcessingIdle}
      />

      {/* Settings Dialog */}
      <Settings
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={saveSettings}
        onLogout={logout}
        isSaving={isSaving}
        isAuthenticated={isAuthenticated}
      />

      {/* Toast notifications */}
      <Toaster position="bottom-center" richColors />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  );
}

export default App;
