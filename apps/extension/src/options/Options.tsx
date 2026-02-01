import { useState, useEffect } from "react";
import { Check, ExternalLink, Loader2, Bell, BellOff } from "lucide-react";
import { storage } from "@/lib/storage";

export function Options() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local form state
  const [webappUrl, setWebappUrl] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [notifyOnClockIn, setNotifyOnClockIn] = useState(true);
  const [notifyOnClockOut, setNotifyOnClockOut] = useState(true);

  useEffect(() => {
    storage.getSettings().then((s) => {
      setWebappUrl(s.webappUrl);
      setNotificationsEnabled(s.notificationsEnabled);
      setNotifyOnClockIn(s.notifyOnClockIn);
      setNotifyOnClockOut(s.notifyOnClockOut);
      setIsLoading(false);
    });
  }, []);

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }
      // Reject URLs with embedded credentials
      if (parsed.username || parsed.password) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  };

  const handleSave = async () => {
    setError(null);

    if (!validateUrl(webappUrl)) {
      setError("Please enter a valid URL (e.g., https://app.example.com)");
      return;
    }

    setIsSaving(true);
    try {
      await storage.saveSettings({
        webappUrl,
        notificationsEnabled,
        notifyOnClockIn,
        notifyOnClockOut,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = () => {
    if (validateUrl(webappUrl)) {
      window.open(webappUrl, "_blank");
    }
  };

  const handleTestNotification = () => {
    chrome.runtime.sendMessage({
      type: "SHOW_NOTIFICATION",
      notificationType: "clock_in",
      message: "This is a test notification!",
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" role="status">
        <Loader2 className="w-8 h-8 text-emerald-500 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-lg mx-auto px-4">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-emerald-500 flex items-center justify-center">
              <span className="text-white text-lg font-bold">Z8</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                Z8 Time Tracker
              </h1>
              <p className="text-sm text-gray-500">Extension Settings</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Webapp URL */}
            <div>
              <label
                htmlFor="webapp-url"
                className="block text-sm font-medium text-gray-700 mb-1.5"
              >
                Webapp URL
              </label>
              <input
                id="webapp-url"
                name="webapp-url"
                type="url"
                value={webappUrl}
                onChange={(e) => setWebappUrl(e.target.value)}
                placeholder="https://app.example.com"
                autoComplete="url"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-500 mt-1.5">
                Enter the URL of your Z8 webapp installation.
              </p>
              {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
            </div>

            {/* Notifications Section */}
            <div className="border-t border-gray-100 pt-6">
              <div className="flex items-center gap-2 mb-4">
                {notificationsEnabled ? (
                  <Bell className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                ) : (
                  <BellOff className="w-4 h-4 text-gray-400" aria-hidden="true" />
                )}
                <h3 className="text-sm font-medium text-gray-900">Notifications</h3>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notificationsEnabled}
                    onChange={(e) => setNotificationsEnabled(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                  />
                  <span className="text-sm text-gray-700">
                    Enable notifications
                  </span>
                </label>

                {notificationsEnabled && (
                  <div className="ml-7 space-y-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyOnClockIn}
                        onChange={(e) => setNotifyOnClockIn(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-gray-600">
                        Notify on clock in
                      </span>
                    </label>

                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={notifyOnClockOut}
                        onChange={(e) => setNotifyOnClockOut(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-gray-600">
                        Notify on clock out
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={handleTestNotification}
                      className="text-xs text-emerald-600 hover:text-emerald-700 mt-1"
                    >
                      Send test notification
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : saved ? (
                  <Check className="w-4 h-4" aria-hidden="true" />
                ) : null}
                <span>{saved ? "Saved!" : "Save Settings"}</span>
              </button>
              <button
                onClick={handleTest}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              >
                <span>Test</span>
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              How to use
            </h3>
            <ol className="text-xs text-gray-600 space-y-1.5 list-decimal list-inside">
              <li>Enter your Z8 webapp URL above and save</li>
              <li>Sign in to the webapp in your browser</li>
              <li>Click the extension icon to clock in/out</li>
            </ol>
          </div>

          {/* Offline Support Info */}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              Offline Support
            </h3>
            <p className="text-xs text-gray-600">
              If you're offline, you can still clock in and out. Actions will be
              queued and automatically synced when you're back online.
            </p>
          </div>
        </div>

        <p className="text-xs text-center text-gray-400 mt-4">
          Z8 Time Tracker Extension v1.0.1
        </p>
      </div>
    </div>
  );
}
