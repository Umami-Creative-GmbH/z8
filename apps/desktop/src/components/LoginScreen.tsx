import { useState } from "react";
import { IconLogin2, IconSettings, IconLoader2, IconClock } from "@tabler/icons-react";
import { useTheme } from "../hooks/useTheme";
import { ThemeToggle } from "./ThemeToggle";

interface LoginScreenProps {
  webappUrl: string;
  onLogin: () => Promise<void>;
  onOpenSettings: () => void;
}

export function LoginScreen({ webappUrl, onLogin, onOpenSettings }: LoginScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { theme, setTheme, resolvedTheme } = useTheme();

  const handleLogin = async () => {
    if (!webappUrl) {
      setError("Please configure the webapp URL first");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onLogin();
    } catch (err) {
      setError("Failed to start login. Please try again.");
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-screen">
      {/* Top buttons */}
      <div className="login-header-buttons">
        <ThemeToggle theme={theme} setTheme={setTheme} resolvedTheme={resolvedTheme} />
        {webappUrl && (
          <button
            type="button"
            aria-label="Open settings"
            onClick={onOpenSettings}
            className="settings-button"
            title="IconSettings"
          >
            <IconSettings size={18} />
          </button>
        )}
      </div>

      {/* Logo/Title */}
      <div className="login-brand">
        <div className="login-logo">
          <IconClock size={36} color="white" />
        </div>
        <h1 className="login-title">z8 Timer</h1>
        <p className="login-subtitle">Your time tracking companion</p>
      </div>

      {/* Main content */}
      <div className="login-content">
        {!webappUrl ? (
          <div className="login-setup">
            <p className="login-setup-text">
              Configure your webapp URL to get started
            </p>
            <button type="button" onClick={onOpenSettings} className="login-button">
              <IconSettings size={20} />
              Open IconSettings
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={handleLogin}
              disabled={isLoading}
              className={`login-button ${isLoading ? "login-button-loading" : ""}`}
            >
              {isLoading ? (
                <IconLoader2 size={20} className="clock-spinner" />
              ) : (
                <IconLogin2 size={20} />
              )}
              {isLoading ? "Opening browser..." : "Sign in with Z8"}
            </button>

            {error && (
              <p className="login-error">{error}</p>
            )}

            <p className="login-hint">
              You'll be redirected to sign in via your browser
            </p>
          </>
        )}
      </div>
    </div>
  );
}
