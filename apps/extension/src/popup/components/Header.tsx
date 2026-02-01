import { Settings } from "lucide-react";

export function Header() {
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center">
          <span className="text-white text-xs font-bold">Z8</span>
        </div>
        <span className="text-sm font-semibold text-gray-900">Time Tracker</span>
      </div>
      <button
        onClick={handleOpenOptions}
        className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
        title="Settings"
        aria-label="Settings"
      >
        <Settings className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
