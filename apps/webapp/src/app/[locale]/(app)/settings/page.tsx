import { SettingsCard } from "@/components/settings/settings-card";
import {
	getEntriesByGroup,
	getVisibleGroups,
	getVisibleSettings,
} from "@/components/settings/settings-config";
import { requireUser } from "@/lib/auth-helpers";

export default async function SettingsPage() {
	const authContext = await requireUser();
	const isAdmin = authContext.employee?.role === "admin";

	const visibleSettings = getVisibleSettings(isAdmin);
	const visibleGroups = getVisibleGroups(isAdmin);

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<h1 className="text-3xl font-semibold mb-2">Settings</h1>
				<p className="text-muted-foreground mb-8">Manage your account and organization settings</p>

				<div className="space-y-8">
					{visibleGroups.map((group) => {
						const groupEntries = getEntriesByGroup(visibleSettings, group.id);

						if (groupEntries.length === 0) return null;

						return (
							<section key={group.id}>
								<h2 className="text-lg font-medium mb-4">{group.labelDefault}</h2>
								<div className="grid gap-4 md:grid-cols-2">
									{groupEntries.map((entry) => (
										<SettingsCard
											key={entry.id}
											title={entry.titleDefault}
											description={entry.descriptionDefault}
											href={entry.href}
											icon={entry.icon}
										/>
									))}
								</div>
							</section>
						);
					})}
				</div>
			</div>
		</div>
	);
}
