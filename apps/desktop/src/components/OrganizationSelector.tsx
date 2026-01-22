import { Building2, Check, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import type { Organization } from "../hooks/useOrganizations";

interface OrganizationSelectorProps {
  organizations: Organization[];
  activeOrganizationId: string | null;
  onSwitch: (organizationId: string) => Promise<void>;
  isSwitching: boolean;
}

export function OrganizationSelector({
  organizations,
  activeOrganizationId,
  onSwitch,
  isSwitching,
}: OrganizationSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeOrg = organizations.find((o) => o.id === activeOrganizationId) || organizations[0];

  if (organizations.length === 0) {
    return null;
  }

  // If only one org, just show it without dropdown
  if (organizations.length === 1) {
    return (
      <div className="org-selector org-selector-single">
        <div className="org-icon">
          {activeOrg.logo ? (
            <img src={activeOrg.logo} alt={activeOrg.name} />
          ) : (
            <Building2 size={14} />
          )}
        </div>
        <span className="org-name">{activeOrg.name}</span>
      </div>
    );
  }

  const handleSelect = async (orgId: string) => {
    if (orgId === activeOrganizationId) {
      setIsOpen(false);
      return;
    }
    await onSwitch(orgId);
    setIsOpen(false);
  };

  return (
    <div className="org-selector-wrapper">
      <button
        className="org-selector"
        onClick={() => setIsOpen(!isOpen)}
        disabled={isSwitching}
      >
        <div className="org-icon">
          {activeOrg?.logo ? (
            <img src={activeOrg.logo} alt={activeOrg.name} />
          ) : (
            <Building2 size={14} />
          )}
        </div>
        <span className="org-name">{activeOrg?.name ?? "Select org"}</span>
        {isSwitching ? (
          <Loader2 size={14} className="clock-spinner" />
        ) : (
          <ChevronDown size={14} className={`org-chevron ${isOpen ? "org-chevron-open" : ""}`} />
        )}
      </button>

      {isOpen && (
        <>
          <div className="org-dropdown-backdrop" onClick={() => setIsOpen(false)} />
          <div className="org-dropdown">
            <div className="org-dropdown-label">Switch Organization</div>
            {organizations.map((org) => (
              <button
                key={org.id}
                className={`org-dropdown-item ${org.id === activeOrganizationId ? "org-dropdown-item-active" : ""}`}
                onClick={() => handleSelect(org.id)}
                disabled={isSwitching}
              >
                <div className="org-icon">
                  {org.logo ? (
                    <img src={org.logo} alt={org.name} />
                  ) : (
                    <Building2 size={14} />
                  )}
                </div>
                <div className="org-dropdown-item-content">
                  <span className="org-name">{org.name}</span>
                  <span className="org-role">{org.memberRole}</span>
                </div>
                {org.id === activeOrganizationId && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
