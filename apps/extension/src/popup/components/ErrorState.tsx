import { AlertCircle, RefreshCw, Settings } from "lucide-react";

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
        <AlertCircle className="w-6 h-6 text-red-500" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Connection Error
      </h3>
      <p className="text-xs text-gray-500 mb-4 px-4">
        {error?.message || "Failed to connect to the Z8 server."}
      </p>
      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors"
        >
          <RefreshCw className="w-4 h-4" aria-hidden="true" />
          <span>Retry</span>
        </button>
        <button
          onClick={handleOpenOptions}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </div>
  );
}
