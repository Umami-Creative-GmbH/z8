import { LogIn, ExternalLink } from "lucide-react";
import { useSettings } from "../hooks/useSettings";

export function LoginRequired() {
  const { webappUrl } = useSettings();

  const handleLogin = () => {
    chrome.tabs.create({ url: `${webappUrl}/sign-in` });
  };

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
        <LogIn className="w-6 h-6 text-slate-400" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-slate-950 mb-1">
        Login Required
      </h3>
      <p className="text-xs text-slate-500 mb-4 px-4">
        Please sign in to the Z8 webapp to use the time tracker.
      </p>
      <button
        onClick={handleLogin}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2"
      >
        <span>Sign In</span>
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
