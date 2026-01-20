import { useState } from "react";
import { LogIn, Settings as SettingsIcon, Loader2 } from "lucide-react";
import { cn } from "../lib/utils";

interface LoginScreenProps {
  webappUrl: string;
  onLogin: () => Promise<void>;
  onOpenSettings: () => void;
}

export function LoginScreen({ webappUrl, onLogin, onOpenSettings }: LoginScreenProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-col items-center justify-center h-full p-6">
      {/* Logo/Title */}
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold mb-1">Z8 Timer</h1>
        <p className="text-sm text-muted-foreground">
          Time tracking companion
        </p>
      </div>

      {/* Main content */}
      <div className="w-full max-w-xs space-y-4">
        {!webappUrl ? (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">
              Configure your webapp URL to get started
            </p>
            <button
              onClick={onOpenSettings}
              className={cn(
                "flex items-center justify-center gap-2 w-full py-3 px-4",
                "bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg",
                "transition-colors font-medium"
              )}
            >
              <SettingsIcon className="w-5 h-5" />
              Open Settings
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={handleLogin}
              disabled={isLoading}
              className={cn(
                "flex items-center justify-center gap-2 w-full py-3 px-4",
                "bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg",
                "transition-colors font-medium",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <LogIn className="w-5 h-5" />
              )}
              {isLoading ? "Opening browser..." : "Sign in with Webapp"}
            </button>

            {error && (
              <p className="text-sm text-destructive text-center">{error}</p>
            )}

            <p className="text-xs text-muted-foreground text-center">
              You'll be redirected to sign in via your browser
            </p>
          </>
        )}
      </div>

      {/* Settings button */}
      {webappUrl && (
        <button
          onClick={onOpenSettings}
          className="absolute top-3 right-3 p-2 hover:bg-muted rounded-md transition-colors"
          title="Settings"
        >
          <SettingsIcon className="w-5 h-5 text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
