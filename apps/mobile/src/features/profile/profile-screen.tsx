import { Pressable, StyleSheet, Text, View } from "react-native";

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
    <View style={styles.container}>
      <Text style={styles.title}>Active organization</Text>
      <View style={styles.list}>
        {organizations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>No organizations available</Text>
            <Text style={styles.emptyStateDescription}>
              Sign in with an account that has an employee record to use mobile time tracking.
            </Text>
          </View>
        ) : (
          organizations.map((organization) => {
            const isActive = organization.id === activeOrganizationId;
            const isUnavailable = !organization.hasEmployeeRecord;
            const isDisabled = isActive || isUnavailable || isSwitchingOrganization;

            return (
              <Pressable
                accessibilityRole="button"
                disabled={isDisabled}
                key={organization.id}
                onPress={isDisabled ? undefined : () => onSwitchOrganization(organization.id)}
                style={[styles.organizationItem, isDisabled && styles.organizationItemDisabled]}
              >
                <Text style={styles.organizationName}>{organization.name}</Text>
                <Text style={styles.organizationMeta}>
                  {isActive
                    ? "Current organization"
                    : !isUnavailable
                      ? "Available for mobile time tracking"
                      : "No employee record"}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={isSigningOut}
        onPress={onSignOut}
        style={[styles.signOutButton, isSigningOut && styles.organizationItemDisabled]}
      >
        <Text style={styles.signOutLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    backgroundColor: "#f8fafc",
  },
  title: {
    fontSize: 24,
    fontWeight: "600",
    color: "#0f172a",
  },
  list: {
    gap: 12,
  },
  emptyState: {
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 16,
    backgroundColor: "#ffffff",
  },
  emptyStateTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  emptyStateDescription: {
    fontSize: 14,
    lineHeight: 20,
    color: "#475569",
  },
  organizationItem: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#dbeafe",
    gap: 4,
  },
  organizationItemDisabled: {
    opacity: 0.55,
  },
  organizationName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0f172a",
  },
  organizationMeta: {
    fontSize: 14,
    color: "#475569",
  },
  signOutButton: {
    marginTop: "auto",
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#0f172a",
    alignItems: "center",
  },
  signOutLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
});
