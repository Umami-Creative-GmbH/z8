import type { ReactNode } from "react";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { useSession } from "@/lib/auth-client";

const proofUpdatedAt = Date.now();

/** Existing component fixtures supply display proof through the real provider. */
export function FinanceTestOrganization({ children }: { children: ReactNode }) {
	const { data } = useSession();
	const organizationId = data?.session.activeOrganizationId;
	const initialContext =
		data && organizationId
			? {
					userId: data.user.id,
					organizationId,
					employee: {
						employeeId: "finance-test-employee",
						organizationId,
						role: "employee" as const,
					},
					organizationSettings: null,
					updatedAt: proofUpdatedAt,
				}
			: null;
	return (
		<OrganizationContextProvider initialContext={initialContext}>
			{children}
		</OrganizationContextProvider>
	);
}
