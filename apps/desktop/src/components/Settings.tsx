import { useState, useEffect } from "react";
import { X, ExternalLink, LogOut } from "lucide-react";
import { cn } from "../lib/utils";
import type { Settings as SettingsType } from "../types";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SettingsType | undefined;
  onSave: (settings: Omit<SettingsType, "version">) => Promise<void>;
  onLogout: () => void;
  isSaving: boolean;
  isAuthenticated: boolean;
}

export function Settings({
  isOpen,
  onClose,
  settings,
  onSave,
  onLogout,
  isSaving,
  isAuthenticated,
}: SettingsProps) {
  const [webappUrl, setWebappUrl] = useState(settings?.webappUrl ?? "");
  const [alwaysOnTop, setAlwaysOnTop] = useState(settings?.alwaysOnTop ?? true);
  const [autoStartup, setAutoStartup] = useState(settings?.autoStartup ?? false);

  useEffect(() => {
    if (settings) {
      setWebappUrl(settings.webappUrl);
      setAlwaysOnTop(settings.alwaysOnTop);
      setAutoStartup(settings.autoStartup);
    }
  }, [settings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    await onSave({ webappUrl, alwaysOnTop, autoStartup });
    onClose();
  };

  const handleLogout = () => {
    onLogout();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Dialog */}
      <div className="relative bg-background rounded-lg shadow-xl p-5 mx-4 max-w-sm w-full border border-border">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded-md transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {/* Webapp URL */}
          <div>
            <label className="block text-sm font-medium mb-1">
              Webapp URL
            </label>
            <input
              type="url"
              value={webappUrl}
              onChange={(e) => setWebappUrl(e.target.value)}
              placeholder="https://your-z8-instance.com"
              className="input"
            />
            <p className="text-xs text-muted-foreground mt-1">
              The URL of your Z8 webapp instance
            </p>
          </div>

          {/* Always on top toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Always on top</label>
              <p className="text-xs text-muted-foreground">
                Keep window above other apps
              </p>
            </div>
            <button
              onClick={() => setAlwaysOnTop(!alwaysOnTop)}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors",
                alwaysOnTop ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow",
                  alwaysOnTop && "translate-x-5"
                )}
              />
            </button>
          </div>

          {/* Auto startup toggle */}
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Start with Windows</label>
              <p className="text-xs text-muted-foreground">
                Launch automatically on login
              </p>
            </div>
            <button
              onClick={() => setAutoStartup(!autoStartup)}
              className={cn(
                "relative w-11 h-6 rounded-full transition-colors",
                autoStartup ? "bg-primary" : "bg-muted"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow",
                  autoStartup && "translate-x-5"
                )}
              />
            </button>
          </div>

          {/* Divider */}
          <hr className="border-border" />

          {/* Logout button */}
          {isAuthenticated && (
            <button
              onClick={handleLogout}
              className="flex items-center justify-center gap-2 w-full py-2 px-4 text-destructive hover:bg-destructive/10 rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          )}

          {/* Version info */}
          <div className="text-center text-xs text-muted-foreground">
            Z8 Timer v{settings?.version ?? "0.1.0"}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 mt-5">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 btn btn-outline rounded-md"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !webappUrl}
            className="flex-1 py-2 px-4 btn btn-primary rounded-md"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
