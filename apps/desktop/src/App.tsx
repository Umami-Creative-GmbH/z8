import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Settings as SettingsIcon, Wifi, WifiOff } from "lucide-react";
import { Toaster, toast } from "sonner";

import { ClockButton } from "./components/ClockButton";
import { IdleDialog } from "./components/IdleDialog";
import { LoginScreen } from "./components/LoginScreen";
import { Settings } from "./components/Settings";

import { useAuth } from "./hooks/useAuth";
import { useClock } from "./hooks/useClock";
import { useIdle } from "./hooks/useIdle";
import { useSettings } from "./hooks/useSettings";

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

  const [isProcessingIdle, setIsProcessingIdle] = useState(false);

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
    // Just dismiss - user says they were working during idle
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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Z8 Timer</span>
          {isError && (
            <WifiOff className="w-4 h-4 text-destructive" title="Connection error" />
          )}
        </div>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-1.5 hover:bg-muted rounded-md transition-colors"
          title="Settings"
        >
          <SettingsIcon className="w-4 h-4 text-muted-foreground" />
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 flex items-center justify-center p-4">
        <ClockButton
          isClockedIn={isClockedIn}
          startTime={activeWorkPeriod?.startTime ?? null}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          isLoading={isClockingIn || isClockingOut}
        />
      </main>

      {/* Footer status */}
      <footer className="px-4 py-2 border-t border-border text-center">
        <span className="text-xs text-muted-foreground">
          {isClockedIn ? (
            <span className="text-success">● Clocked In</span>
          ) : (
            <span className="text-muted-foreground">○ Clocked Out</span>
          )}
        </span>
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
