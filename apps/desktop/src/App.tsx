import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settings as SettingsIcon, WifiOff, Clock, Sun, Moon, Monitor } from "lucide-react";
import { Toaster, toast } from "sonner";

import { ClockButton } from "./components/ClockButton";
import { IdleDialog } from "./components/IdleDialog";
import { LoginScreen } from "./components/LoginScreen";
import { OrganizationSelector } from "./components/OrganizationSelector";
import { Settings } from "./components/Settings";

import { useAuth } from "./hooks/useAuth";
import { useClock } from "./hooks/useClock";
import { useIdle } from "./hooks/useIdle";
import { useOrganizations } from "./hooks/useOrganizations";
import { useSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10000,
    },
  },
});

function AppContent() {
  const { isAuthenticated, login, logout, isLoading: isAuthLoading } = useAuth();
  const {
    settings,
    saveSettings,
    isSaving,
    isSettingsOpen,
    setIsSettingsOpen,
  } = useSettings();
  const {
    isClockedIn,
    activeWorkPeriod,
    clockIn,
    clockOut,
    clockOutWithBreak,
    isClockingIn,
    isClockingOut,
    isError,
  } = useClock();
  const { idleEvent, isIdleDialogOpen, dismissIdle } = useIdle();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const {
    organizations,
    activeOrganizationId,
    switchOrganization,
    isSwitching,
  } = useOrganizations();

  const [isProcessingIdle, setIsProcessingIdle] = useState(false);

  const cycleTheme = () => {
    if (theme === "system") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("system");
  };

  const ThemeIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  const handleClockIn = async () => {
    try {
      await clockIn();
      toast.success("Clocked in successfully");
    } catch (error) {
      toast.error("Failed to clock in");
      console.error(error);
    }
  };

  const handleClockOut = async () => {
    try {
      await clockOut();
      toast.success("Clocked out successfully");
    } catch (error) {
      toast.error("Failed to clock out");
      console.error(error);
    }
  };

  const handleIdleBreak = async () => {
    if (!idleEvent) return;

    setIsProcessingIdle(true);
    try {
      await clockOutWithBreak(idleEvent.idleStartTime);
      toast.success("Break recorded, clocked back in");
      dismissIdle();
    } catch (error) {
      toast.error("Failed to record break");
      console.error(error);
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
              <Clock size={18} color="white" />
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
              isSwitching={isSwitching}
            />
          )}
        </div>
        <div className="app-header-actions">
          {isError && (
            <div className="offline-badge">
              <WifiOff size={14} />
              <span>Offline</span>
            </div>
          )}
          <button
            onClick={cycleTheme}
            className="settings-button"
            title={`Theme: ${theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}`}
          >
            <ThemeIcon size={18} />
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="settings-button"
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="app-main">
        <ClockButton
          isClockedIn={isClockedIn}
          startTime={activeWorkPeriod?.startTime ?? null}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          isLoading={isClockingIn || isClockingOut}
        />
      </main>

      {/* Footer status */}
      <footer className="app-footer">
        <div className={`status-badge ${isClockedIn ? "status-active" : "status-inactive"}`}>
          <div className="status-dot" />
          <span>{isClockedIn ? "Currently Working" : "Not Clocked In"}</span>
        </div>
      </footer>

      {/* Idle Dialog */}
      <IdleDialog
        isOpen={isIdleDialogOpen}
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
