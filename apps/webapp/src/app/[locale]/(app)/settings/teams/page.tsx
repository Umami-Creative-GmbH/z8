"use client";

import { IconLoader2, IconPlus, IconUsers } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { queryKeys } from "@/lib/query";
import { Link } from "@/navigation";
import { getCurrentEmployee } from "../../approvals/actions";
import { listTeams } from "./actions";

export default function TeamsPage() {
	const { t } = useTranslate();
	const [canCreate, setCanCreate] = useState(false);

	// Fetch teams with TanStack Query
	const { data: teams = [], isLoading } = useQuery({
		queryKey: queryKeys.teams.all,
		queryFn: async () => {
			const result = await listTeams();
			if (!result.success) {
				throw new Error(result.error || "Failed to load teams");
			}
			return result.data;
		},
	});

	useEffect(() => {
		async function loadCurrentEmployee() {
			const currentEmp = await getCurrentEmployee();
			if (currentEmp) {
				setCanCreate(currentEmp.role === "admin");
			}
		}
		loadCurrentEmployee();
	}, []);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.teams.title", "Teams")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("settings.teams.description", "Organize employees into teams for better management")}
					</p>
				</div>
				{canCreate && (
					<Button asChild>
						<Link href="/settings/teams/new">
							<IconPlus className="mr-2 size-4" />
							Create Team
						</Link>
					</Button>
				)}
			</div>

			<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				{isLoading ? (
					<div className="col-span-full flex items-center justify-center p-8">
						<IconLoader2 className="size-8 animate-spin text-muted-foreground" />
					</div>
				) : teams.length === 0 ? (
					<Card className="col-span-full">
						<CardContent className="flex flex-col items-center justify-center py-8">
							<IconUsers className="mb-4 size-12 text-muted-foreground" />
							<p className="text-sm text-muted-foreground">No teams found</p>
						</CardContent>
					</Card>
				) : (
					teams.map((team) => (
						<Card key={team.id} className="hover:bg-accent transition-colors">
							<CardHeader>
								<CardTitle className="flex items-center justify-between">
									<span>{team.name}</span>
									<IconUsers className="size-5 text-muted-foreground" />
								</CardTitle>
								{team.description && <CardDescription>{team.description}</CardDescription>}
							</CardHeader>
							<CardContent>
								<div className="flex items-center justify-between">
									<span className="text-sm text-muted-foreground">
										{(team as any).employees?.length || 0} members
									</span>
									<Button variant="ghost" size="sm" asChild>
										<Link href={`/settings/teams/${team.id}`}>View Details</Link>
									</Button>
								</div>
							</CardContent>
						</Card>
					))
				)}
			</div>
		</div>
	);
}
