import { IconAlertCircle, IconRefresh, IconSettings } from "@tabler/icons-react";

interface ErrorStateProps {
  error: Error | null;
  onRetry: () => void;
}

export function ErrorState({ error, onRetry }: ErrorStateProps) {
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
        <IconAlertCircle className="w-6 h-6 text-red-500" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-slate-950 mb-1">
        Connection Error
      </h3>
      <p className="text-xs text-slate-500 mb-4 px-4">
        {error?.message || "Failed to connect to the Z8 server."}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <IconRefresh className="w-4 h-4" aria-hidden="true" />
          <span>Retry</span>
        </button>
        <button
          onClick={handleOpenOptions}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        >
          <IconSettings className="w-4 h-4" aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
