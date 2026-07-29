import { useEffect, useId, useState } from "react";
import { IconX, IconLogout2, IconSettings as SettingsIcon } from "@tabler/icons-react";
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

interface SettingsViewModel {
  alwaysOnTop: boolean;
  autoStartup: boolean;
  cancelHovered: boolean;
  isAuthenticated: boolean;
  isSaving: boolean;
  logoutHovered: boolean;
  saveHovered: boolean;
  version: string;
  webappUrl: string;
  onCancelHoverChange: (hovered: boolean) => void;
  onLogout: () => void;
  onLogoutHoverChange: (hovered: boolean) => void;
  onSave: () => void;
  onSaveHoverChange: (hovered: boolean) => void;
  onToggleAlwaysOnTop: () => void;
  onToggleAutoStartup: () => void;
  onWebappUrlChange: (value: string) => void;
}

function SettingsHeader({ onClose }: { onClose: () => void }) {
  return (
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
        type="button"
        aria-label="Close settings"
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
        <IconX size={18} color="var(--color-muted-foreground)" />
      </button>
    </div>
  );
}

function SettingsToggle({
  checked,
  description,
  label,
  onToggle,
}: {
  checked: boolean;
  description: string;
  label: string;
  onToggle: () => void;
}) {
  const controlId = useId();

  return (
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
        <label htmlFor={controlId} style={{ fontSize: "14px", fontWeight: 500 }}>{label}</label>
        <p style={{ fontSize: "12px", color: "var(--color-muted-foreground)", margin: 0 }}>
          {description}
        </p>
      </div>
      <button
        id={controlId}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onToggle}
        style={{
          position: "relative",
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          border: "none",
          cursor: "pointer",
          background: checked ? "var(--color-primary)" : "var(--color-border)",
          transition: "background 0.2s ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: "2px",
            left: checked ? "22px" : "2px",
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
  );
}

function SettingsContent({ viewModel }: { viewModel: SettingsViewModel }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <label
          htmlFor="webapp-url"
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
          id="webapp-url"
          name="webappUrl"
          type="url"
          autoComplete="off"
          value={viewModel.webappUrl}
          onChange={(event) => viewModel.onWebappUrlChange(event.target.value)}
          placeholder="Example: https://ui.z8-time.app…"
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
          onFocus={(event) => {
            event.target.style.borderColor = "var(--color-primary)";
            event.target.style.boxShadow = "0 0 0 3px hsl(221.2 83.2% 53.3% / 0.15)";
          }}
          onBlur={(event) => {
            event.target.style.borderColor = "var(--color-border)";
            event.target.style.boxShadow = "none";
          }}
        />
        <p style={{ fontSize: "12px", color: "var(--color-muted-foreground)", marginTop: "6px" }}>
          The URL of your Z8 webapp instance
        </p>
      </div>

      <SettingsToggle
        checked={viewModel.alwaysOnTop}
        description="Keep window above other apps"
        label="Always on top"
        onToggle={viewModel.onToggleAlwaysOnTop}
      />
      <SettingsToggle
        checked={viewModel.autoStartup}
        description="Launch automatically on login"
        label="Start with Windows"
        onToggle={viewModel.onToggleAutoStartup}
      />

      <hr style={{ border: "none", borderTop: "1px solid var(--color-border)", margin: 0 }} />

      {viewModel.isAuthenticated && (
        <button
          type="button"
          onClick={viewModel.onLogout}
          onMouseEnter={() => viewModel.onLogoutHoverChange(true)}
          onMouseLeave={() => viewModel.onLogoutHoverChange(false)}
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
            background: viewModel.logoutHovered ? "hsl(0 84.2% 60.2% / 0.1)" : "transparent",
            border: "1px solid var(--color-border)",
            borderRadius: "10px",
            cursor: "pointer",
            transition: "background 0.15s ease",
          }}
        >
          <IconLogout2 size={16} />
          Sign out
        </button>
      )}

      <div style={{ textAlign: "center", fontSize: "12px", color: "var(--color-muted-foreground)" }}>
        z8 Timer v{viewModel.version}
      </div>
    </div>
  );
}

function SettingsFooter({ viewModel, onClose }: { viewModel: SettingsViewModel; onClose: () => void }) {
  const saveDisabled = viewModel.isSaving || !viewModel.webappUrl;

  return (
    <div style={{ display: "flex", gap: "12px", marginTop: "24px" }}>
      <button
        type="button"
        onClick={onClose}
        onMouseEnter={() => viewModel.onCancelHoverChange(true)}
        onMouseLeave={() => viewModel.onCancelHoverChange(false)}
        style={{
          flex: 1,
          padding: "12px 16px",
          fontSize: "14px",
          fontWeight: 600,
          color: "var(--color-foreground)",
          background: viewModel.cancelHovered ? "var(--color-muted)" : "var(--color-background)",
          border: "2px solid var(--color-border)",
          borderRadius: "10px",
          cursor: "pointer",
          transition: "background 0.15s ease",
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={viewModel.onSave}
        disabled={saveDisabled}
        onMouseEnter={() => viewModel.onSaveHoverChange(true)}
        onMouseLeave={() => viewModel.onSaveHoverChange(false)}
        style={{
          flex: 1,
          padding: "12px 16px",
          fontSize: "14px",
          fontWeight: 600,
          color: "white",
          background: saveDisabled
            ? "var(--color-muted-foreground)"
            : viewModel.saveHovered
              ? "hsl(221.2 83.2% 45%)"
              : "var(--color-primary)",
          border: "none",
          borderRadius: "10px",
          cursor: saveDisabled ? "not-allowed" : "pointer",
          opacity: saveDisabled ? 0.6 : 1,
          transition: "background 0.15s ease",
        }}
      >
        {viewModel.isSaving ? "Saving..." : "Save"}
      </button>
    </div>
  );
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

  const viewModel: SettingsViewModel = {
    alwaysOnTop,
    autoStartup,
    cancelHovered,
    isAuthenticated,
    isSaving,
    logoutHovered,
    saveHovered,
    version: settings?.version ?? "0.1.0",
    webappUrl,
    onCancelHoverChange: setCancelHovered,
    onLogout: handleLogout,
    onLogoutHoverChange: setLogoutHovered,
    onSave: handleSave,
    onSaveHoverChange: setSaveHovered,
    onToggleAlwaysOnTop: () => setAlwaysOnTop(!alwaysOnTop),
    onToggleAutoStartup: () => setAutoStartup(!autoStartup),
    onWebappUrlChange: setWebappUrl,
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
        aria-hidden="true"
        tabIndex={-1}
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
        <SettingsHeader onClose={onClose} />
        <SettingsContent viewModel={viewModel} />
        <SettingsFooter viewModel={viewModel} onClose={onClose} />
      </div>
    </div>
  );
}
