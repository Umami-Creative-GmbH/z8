import {
	IconBeach,
	IconBuilding,
	IconCalendarEvent,
	IconShield,
	IconUserCircle,
	IconUsers,
} from "@tabler/icons-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { requireUser } from "@/lib/auth-helpers";

export default async function SettingsPage() {
	const authContext = await requireUser();
	const isAdmin = authContext.employee?.role === "admin";

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<h1 className="text-3xl font-semibold mb-2">Settings</h1>
				<p className="text-muted-foreground mb-8">Manage your account and organization settings</p>

				<div className="grid gap-4 md:grid-cols-2">
					{/* Profile Card - Always visible */}
					<SettingsCard
						title="Profile"
						description="Manage your personal information and profile picture"
						href="/settings/profile"
						icon={IconUserCircle}
					/>

					{/* Organizations & Teams Card - Always visible */}
					<SettingsCard
						title="Organizations & Teams"
						description="Manage organization members, invitations, and teams"
						href="/settings/organizations"
						icon={IconBuilding}
					/>

					{/* Security Card - Always visible */}
					<SettingsCard
						title="Security"
						description="Manage your password and active sessions"
						href="/settings/security"
						icon={IconShield}
					/>

					{/* Admin-only cards */}
					{isAdmin && (
						<>
							<SettingsCard
								title="Employees"
								description="Manage employee profiles, roles, and manager assignments"
								href="/settings/employees"
								icon={IconUsers}
							/>
							<SettingsCard
								title="Holidays"
								description="Configure organization holidays and time off"
								href="/settings/holidays"
								icon={IconCalendarEvent}
							/>
							<SettingsCard
								title="Vacation"
								description="Manage vacation policies and allowances"
								href="/settings/vacation"
								icon={IconBeach}
							/>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
