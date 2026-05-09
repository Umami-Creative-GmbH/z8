import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useClock } from "./hooks/useClock";
import { useProjects } from "./hooks/useProjects";
import { Header } from "./components/Header";
import { Timer } from "./components/Timer";
import { ClockButton } from "./components/ClockButton";
import { ProjectSelector } from "./components/ProjectSelector";
import { LoginRequired } from "./components/LoginRequired";
import { NoEmployee } from "./components/NoEmployee";
import { ErrorState } from "./components/ErrorState";
import { Loading } from "./components/Loading";
import { OfflineBanner } from "./components/OfflineBanner";
import { StatusCard } from "./components/StatusCard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function PopupContent() {
  const {
    isLoading,
    isError,
    isNotAuthenticated,
    isOffline,
    isNetworkError,
    queueLength,
    lastAction,
    error,
    isClockedIn,
    hasEmployee,
    activeWorkPeriod,
    clockIn,
    clockOut,
    isClockingIn,
    isClockingOut,
    refetch,
  } = useClock();

  const { data: projectsData } = useProjects(isClockedIn && !isOffline);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();

  // Show loading only on initial load, not when offline with optimistic state
  if (isLoading && !isOffline) {
    return <Loading />;
  }

  if (isNotAuthenticated) {
    return <LoginRequired />;
  }

  // Show error state only for non-network errors when online
  if (isError && !isNetworkError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  // Online connection failures without usable state still need a blocking retry state.
  if (isNetworkError && !isOffline && !isClockedIn && queueLength === 0) {
    return (
      <>
        <OfflineBanner queueLength={queueLength} />
        <ErrorState
          error={new Error("Unable to connect. Check your internet connection.")}
          onRetry={() => refetch()}
        />
      </>
    );
  }

  if (!hasEmployee && !isOffline) {
    return <NoEmployee />;
  }

  const handleClockIn = async () => {
    try {
      await clockIn();
    } catch (err) {
      console.error("Clock in failed:", err);
    }
  };

  const handleClockOut = async () => {
    try {
      await clockOut(selectedProjectId);
      setSelectedProjectId(undefined);
    } catch (err) {
      console.error("Clock out failed:", err);
    }
  };

  return (
    <>
      {isOffline && <OfflineBanner queueLength={queueLength} />}

      <div className="p-4">
        <StatusCard
          isClockedIn={isClockedIn}
          isOffline={isOffline}
          queueLength={queueLength}
          startTime={activeWorkPeriod?.startTime}
          lastAction={lastAction}
        />

        {isClockedIn && activeWorkPeriod && (
          <Timer startTime={activeWorkPeriod.startTime} />
        )}

        <ClockButton
          isClockedIn={isClockedIn}
          onClockIn={handleClockIn}
          onClockOut={handleClockOut}
          isLoading={isClockingIn || isClockingOut}
        />

        {isClockedIn && !isOffline && projectsData?.projects && (
          <ProjectSelector
            projects={projectsData.projects}
            selectedId={selectedProjectId}
            onChange={setSelectedProjectId}
          />
        )}

        {isClockedIn && isOffline && (
          <p className="mt-3 text-xs text-center text-gray-400">
            Project selection available when online
          </p>
        )}
      </div>
    </>
  );
}

export function Popup() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-80 bg-slate-50 text-slate-950">
        <Header />
        <PopupContent />
      </div>
    </QueryClientProvider>
  );
}
