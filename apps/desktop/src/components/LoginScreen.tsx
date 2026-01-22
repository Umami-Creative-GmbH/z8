import { useState } from "react";
import { LogIn, Settings as SettingsIcon, Loader2, Clock, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "../hooks/useTheme";

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

  const cycleTheme = () => {
    if (theme === "system") setTheme("light");
    else if (theme === "light") setTheme("dark");
    else setTheme("system");
  };

  const ThemeIcon = theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <div className="login-screen">
      {/* Top buttons */}
      <div className="login-header-buttons">
        <button
          onClick={cycleTheme}
          className="settings-button"
          title={`Theme: ${theme === "system" ? "System" : theme === "light" ? "Light" : "Dark"}`}
        >
          <ThemeIcon size={18} />
        </button>
        {webappUrl && (
          <button
            onClick={onOpenSettings}
            className="settings-button"
            title="Settings"
          >
            <SettingsIcon size={18} />
          </button>
        )}
      </div>

      {/* Logo/Title */}
      <div className="login-brand">
        <div className="login-logo">
          <Clock size={36} color="white" />
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
            <button onClick={onOpenSettings} className="login-button">
              <SettingsIcon size={20} />
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className={`login-button ${isLoading ? "login-button-loading" : ""}`}
            >
              {isLoading ? (
                <Loader2 size={20} className="clock-spinner" />
              ) : (
                <LogIn size={20} />
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
