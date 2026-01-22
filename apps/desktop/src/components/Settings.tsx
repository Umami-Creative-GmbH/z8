import { useState, useEffect } from "react";
import { X, LogOut, Settings as SettingsIcon } from "lucide-react";
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
  const [saveHovered, setSaveHovered] = useState(false);
  const [cancelHovered, setCancelHovered] = useState(false);
  const [logoutHovered, setLogoutHovered] = useState(false);

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
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Backdrop */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.4)",
          backdropFilter: "blur(4px)",
        }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        style={{
          position: "relative",
          background: "var(--color-background)",
          borderRadius: "16px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          padding: "24px",
          margin: "16px",
          maxWidth: "360px",
          width: "100%",
          border: "1px solid var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "24px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "var(--color-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <SettingsIcon size={20} color="var(--color-muted-foreground)" />
            </div>
            <h2 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>Settings</h2>
          </div>
          <button
            onClick={onClose}
            style={{
              padding: "8px",
              borderRadius: "8px",
              border: "none",
              background: "var(--color-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={18} color="var(--color-muted-foreground)" />
          </button>
        </div>

        {/* Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Webapp URL */}
          <div>
            <label
              style={{
                display: "block",
                fontSize: "14px",
                fontWeight: 500,
                marginBottom: "8px",
                color: "var(--color-foreground)",
              }}
            >
              Webapp URL
            </label>
            <input
              type="url"
              value={webappUrl}
              onChange={(e) => setWebappUrl(e.target.value)}
              placeholder="https://your-z8-instance.com"
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: "14px",
                borderRadius: "10px",
                border: "2px solid var(--color-border)",
                background: "var(--color-background)",
                color: "var(--color-foreground)",
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s ease, box-shadow 0.15s ease",
              }}
              onFocus={(e) => {
                e.target.style.borderColor = "var(--color-primary)";
                e.target.style.boxShadow = "0 0 0 3px hsl(221.2 83.2% 53.3% / 0.15)";
              }}
              onBlur={(e) => {
                e.target.style.borderColor = "var(--color-border)";
                e.target.style.boxShadow = "none";
              }}
            />
            <p
              style={{
                fontSize: "12px",
                color: "var(--color-muted-foreground)",
                marginTop: "6px",
              }}
            >
              The URL of your Z8 webapp instance
            </p>
          </div>

          {/* Always on top toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              background: "var(--color-muted)",
              borderRadius: "10px",
            }}
          >
            <div>
              <label style={{ fontSize: "14px", fontWeight: 500 }}>Always on top</label>
              <p style={{ fontSize: "12px", color: "var(--color-muted-foreground)", margin: 0 }}>
                Keep window above other apps
              </p>
            </div>
            <button
              onClick={() => setAlwaysOnTop(!alwaysOnTop)}
              style={{
                position: "relative",
                width: "44px",
                height: "24px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                background: alwaysOnTop ? "var(--color-primary)" : "var(--color-border)",
                transition: "background 0.2s ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: alwaysOnTop ? "22px" : "2px",
                  width: "20px",
                  height: "20px",
                  background: "white",
                  borderRadius: "50%",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  transition: "left 0.2s ease",
                }}
              />
            </button>
          </div>

          {/* Auto startup toggle */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              background: "var(--color-muted)",
              borderRadius: "10px",
            }}
          >
            <div>
              <label style={{ fontSize: "14px", fontWeight: 500 }}>Start with Windows</label>
              <p style={{ fontSize: "12px", color: "var(--color-muted-foreground)", margin: 0 }}>
                Launch automatically on login
              </p>
            </div>
            <button
              onClick={() => setAutoStartup(!autoStartup)}
              style={{
                position: "relative",
                width: "44px",
                height: "24px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                background: autoStartup ? "var(--color-primary)" : "var(--color-border)",
                transition: "background 0.2s ease",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: "2px",
                  left: autoStartup ? "22px" : "2px",
                  width: "20px",
                  height: "20px",
                  background: "white",
                  borderRadius: "50%",
                  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                  transition: "left 0.2s ease",
                }}
              />
            </button>
          </div>

          {/* Divider */}
          <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: 0 }} />

          {/* Logout button */}
          {isAuthenticated && (
            <button
              onClick={handleLogout}
              onMouseEnter={() => setLogoutHovered(true)}
              onMouseLeave={() => setLogoutHovered(false)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                width: "100%",
                padding: "12px",
                fontSize: "14px",
                fontWeight: 500,
                color: "var(--color-destructive)",
                background: logoutHovered ? "hsl(0 84.2% 60.2% / 0.1)" : "transparent",
                border: "1px solid var(--color-border)",
                borderRadius: "10px",
                cursor: "pointer",
                transition: "background 0.15s ease",
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          )}

          {/* Version info */}
          <div
            style={{
              textAlign: "center",
              fontSize: "12px",
              color: "var(--color-muted-foreground)",
            }}
          >
            z8 Timer v{settings?.version ?? "0.1.0"}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
          <button
            onClick={onClose}
            onMouseEnter={() => setCancelHovered(true)}
            onMouseLeave={() => setCancelHovered(false)}
            style={{
              flex: 1,
              padding: "12px 16px",
              fontSize: "14px",
              fontWeight: 600,
              color: "var(--color-foreground)",
              background: cancelHovered ? "var(--color-muted)" : "var(--color-background)",
              border: "2px solid var(--color-border)",
              borderRadius: "10px",
              cursor: "pointer",
              transition: "background 0.15s ease",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !webappUrl}
            onMouseEnter={() => setSaveHovered(true)}
            onMouseLeave={() => setSaveHovered(false)}
            style={{
              flex: 1,
              padding: "12px 16px",
              fontSize: "14px",
              fontWeight: 600,
              color: "white",
              background:
                isSaving || !webappUrl
                  ? "var(--color-muted-foreground)"
                  : saveHovered
                  ? "hsl(221.2 83.2% 45%)"
                  : "var(--color-primary)",
              border: "none",
              borderRadius: "10px",
              cursor: isSaving || !webappUrl ? "not-allowed" : "pointer",
              opacity: isSaving || !webappUrl ? 0.6 : 1,
              transition: "background 0.15s ease",
            }}
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
