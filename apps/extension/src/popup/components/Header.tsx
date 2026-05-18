import { IconSettings } from "@tabler/icons-react";

export function Header() {
  const handleOpenOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded bg-blue-600 flex items-center justify-center">
          <span className="text-white text-xs font-bold">Z8</span>
        </div>
        <span className="text-sm font-semibold text-slate-950">Time Tracker</span>
      </div>
      <button
        onClick={handleOpenOptions}
        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
        title="Settings"
        aria-label="Settings"
      >
        <IconSettings className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
