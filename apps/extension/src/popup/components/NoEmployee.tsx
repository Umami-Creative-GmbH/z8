import { UserX, ExternalLink } from "@tabler/icons-react";
import { useSettings } from "../hooks/useSettings";

export function NoEmployee() {
  const { webappUrl } = useSettings();

  const handleOpenApp = () => {
    chrome.tabs.create({ url: webappUrl });
  };

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center mb-3">
        <UserX className="w-6 h-6 text-amber-500" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-slate-950 mb-1">
        No Employee Record
      </h3>
      <p className="text-xs text-slate-500 mb-4 px-4">
        You don't have an employee profile in this organization. Contact your
        admin or switch organizations.
      </p>
      <button
        onClick={handleOpenApp}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <span>Open Z8</span>
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
