import { Button, Column, Host, List, ListItem, Text } from "@expo/ui";
import { StyleSheet } from "react-native";

import type { MobileSessionOrganization } from "@/src/features/session/use-mobile-session";

interface ProfileScreenProps {
  activeOrganizationId: string | null;
  organizations: MobileSessionOrganization[];
  isSwitchingOrganization: boolean;
  isSigningOut: boolean;
  onSwitchOrganization: (organizationId: string) => void;
  onSignOut: () => void;
}

export function ProfileScreen({
  activeOrganizationId,
  organizations,
  isSwitchingOrganization,
  isSigningOut,
  onSwitchOrganization,
  onSignOut,
}: ProfileScreenProps) {
  return (
    <Host style={styles.container}>
      <Column spacing={16}>
        <Text textStyle={styles.titleText}>Active organization</Text>
        <List>
          {organizations.length === 0 ? (
            <Column spacing={6} style={styles.emptyState}>
              <Text textStyle={styles.emptyStateTitleText}>No organizations available</Text>
              <Text textStyle={styles.emptyStateDescriptionText}>
                Sign in with an account that has an employee record to use mobile time tracking.
              </Text>
            </Column>
          ) : (
            organizations.map((organization) => {
              const isActive = organization.id === activeOrganizationId;
              const isUnavailable = !organization.hasEmployeeRecord;
              const isDisabled = isActive || isUnavailable || isSwitchingOrganization;
              const supportingText = isActive
                ? "Current organization"
                : isUnavailable
                  ? "No employee record"
                  : isSwitchingOrganization
                    ? "Switching organization…"
                    : "Available for mobile time tracking";
              const organizationTitle = isActive ? `${organization.name} (current)` : organization.name;

              return (
                <ListItem
                  key={organization.id}
                  onPress={isDisabled ? undefined : () => onSwitchOrganization(organization.id)}
                  supportingText={supportingText}
                >
                  {organizationTitle}
                </ListItem>
              );
            })
          )}
        </List>
        <Button label="Sign out" disabled={isSigningOut} onPress={onSignOut} />
      </Column>
    </Host>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: "#f8fafc",
  },
  titleText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0f172a",
  },
  emptyState: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    backgroundColor: "#ffffff",
  },
  emptyStateTitleText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  emptyStateDescriptionText: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
});
