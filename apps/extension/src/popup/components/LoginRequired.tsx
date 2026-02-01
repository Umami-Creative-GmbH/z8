import { LogIn, ExternalLink } from "lucide-react";
import { useSettings } from "../hooks/useSettings";

export function LoginRequired() {
  const { webappUrl } = useSettings();

  const handleLogin = () => {
    chrome.tabs.create({ url: `${webappUrl}/sign-in` });
  };

  return (
    <div className="flex flex-col items-center justify-center py-6 text-center">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <LogIn className="w-6 h-6 text-gray-400" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">
        Login Required
      </h3>
      <p className="text-xs text-gray-500 mb-4 px-4">
        Please sign in to the Z8 webapp to use the time tracker.
      </p>
      <button
        onClick={handleLogin}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors"
      >
        <span>Sign In</span>
        <ExternalLink className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
