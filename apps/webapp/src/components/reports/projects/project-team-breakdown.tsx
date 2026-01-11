"use client";

import { IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@/components/ui/chart";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
	ProjectTeamMember,
	ProjectTeamBreakdown as TeamBreakdownData,
} from "@/lib/reports/project-types";

interface ProjectTeamBreakdownProps {
	teamBreakdown: TeamBreakdownData[];
	employeeBreakdown: ProjectTeamMember[];
}

const COLORS = [
	"hsl(var(--chart-1))",
	"hsl(var(--chart-2))",
	"hsl(var(--chart-3))",
	"hsl(var(--chart-4))",
	"hsl(var(--chart-5))",
	"hsl(220, 70%, 50%)",
	"hsl(160, 60%, 45%)",
	"hsl(30, 80%, 55%)",
	"hsl(280, 65%, 60%)",
	"hsl(340, 75%, 55%)",
];

export function ProjectTeamBreakdown({
	teamBreakdown,
	employeeBreakdown,
}: ProjectTeamBreakdownProps) {
	const [activeTab, setActiveTab] = useState<"employees" | "teams">("employees");

	// Prepare chart data
	const employeeChartData = employeeBreakdown
		.sort((a, b) => b.totalHours - a.totalHours)
		.slice(0, 10)
		.map((emp, index) => ({
			name: emp.employeeName,
			hours: emp.totalHours,
			fill: COLORS[index % COLORS.length],
		}));

	const teamChartData = teamBreakdown
		.sort((a, b) => b.totalHours - a.totalHours)
		.map((team, index) => ({
			name: team.teamName,
			hours: team.totalHours,
			fill: COLORS[index % COLORS.length],
		}));

	const employeeChartConfig: ChartConfig = employeeChartData.reduce((acc, emp) => {
		acc[emp.name] = { label: emp.name, color: emp.fill };
		return acc;
	}, {} as ChartConfig);

	const teamChartConfig: ChartConfig = teamChartData.reduce((acc, team) => {
		acc[team.name] = { label: team.name, color: team.fill };
		return acc;
	}, {} as ChartConfig);

	if (employeeBreakdown.length === 0) {
		return (
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconUsers className="h-5 w-5" />
						Team Breakdown
					</CardTitle>
					<CardDescription>No team members have logged time to this project</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUsers className="h-5 w-5" />
					Team Breakdown
				</CardTitle>
				<CardDescription>Hours distribution across team members and teams</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "employees" | "teams")}>
					<TabsList className="mb-4">
						<TabsTrigger value="employees">By Employee</TabsTrigger>
						<TabsTrigger value="teams">By Team</TabsTrigger>
					</TabsList>

					<TabsContent value="employees" className="space-y-4">
						<div className="grid gap-4 lg:grid-cols-2">
							{/* Pie Chart */}
							<ChartContainer config={employeeChartConfig} className="h-[300px]">
								<PieChart>
									<ChartTooltip
										content={
											<ChartTooltipContent
												formatter={(value) => [`${Number(value).toFixed(1)}h`, "Hours"]}
											/>
										}
									/>
									<Pie
										data={employeeChartData}
										dataKey="hours"
										nameKey="name"
										cx="50%"
										cy="50%"
										outerRadius={100}
										label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
										labelLine={false}
									>
										{employeeChartData.map((entry) => (
											<Cell key={`cell-${entry.name}`} fill={entry.fill} />
										))}
									</Pie>
								</PieChart>
							</ChartContainer>

							{/* Table */}
							<div className="overflow-auto max-h-[300px]">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Employee</TableHead>
											<TableHead className="text-right">Hours</TableHead>
											<TableHead className="text-right">%</TableHead>
											<TableHead className="text-right">Sessions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{employeeBreakdown
											.sort((a, b) => b.totalHours - a.totalHours)
											.map((emp) => (
												<TableRow key={emp.employeeId}>
													<TableCell className="font-medium">{emp.employeeName}</TableCell>
													<TableCell className="text-right tabular-nums">
														{emp.totalHours.toFixed(1)}h
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{emp.percentOfTotal.toFixed(0)}%
													</TableCell>
													<TableCell className="text-right tabular-nums">
														{emp.workPeriodCount}
													</TableCell>
												</TableRow>
											))}
									</TableBody>
								</Table>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="teams" className="space-y-4">
						<div className="grid gap-4 lg:grid-cols-2">
							{/* Bar Chart */}
							<ChartContainer config={teamChartConfig} className="h-[300px]">
								<BarChart
									accessibilityLayer
									data={teamChartData}
									layout="vertical"
									margin={{ left: 0 }}
								>
									<CartesianGrid horizontal={false} />
									<YAxis
										dataKey="name"
										type="category"
										tickLine={false}
										tickMargin={10}
										axisLine={false}
										width={100}
									/>
									<XAxis
										dataKey="hours"
										type="number"
										tickLine={false}
										axisLine={false}
										tickFormatter={(value) => `${value}h`}
									/>
									<ChartTooltip
										content={
											<ChartTooltipContent
												formatter={(value) => [`${Number(value).toFixed(1)}h`, "Hours"]}
											/>
										}
									/>
									<Bar dataKey="hours" radius={4}>
										{teamChartData.map((entry) => (
											<Cell key={`cell-${entry.name}`} fill={entry.fill} />
										))}
									</Bar>
								</BarChart>
							</ChartContainer>

							{/* Team Details */}
							<div className="space-y-4 overflow-auto max-h-[300px]">
								{teamBreakdown
									.sort((a, b) => b.totalHours - a.totalHours)
									.map((team) => (
										<div key={team.teamId} className="space-y-2">
											<div className="flex items-center justify-between">
												<span className="font-medium">{team.teamName}</span>
												<Badge variant="secondary">
													{team.totalHours.toFixed(1)}h ({team.percentOfTotal.toFixed(0)}%)
												</Badge>
											</div>
											<div className="pl-4 space-y-1">
												{team.members
													.sort((a, b) => b.totalHours - a.totalHours)
													.map((member) => (
														<div
															key={member.employeeId}
															className="flex justify-between text-sm text-muted-foreground"
														>
															<span>{member.employeeName}</span>
															<span className="tabular-nums">{member.totalHours.toFixed(1)}h</span>
														</div>
													))}
											</div>
										</div>
									))}
							</div>
						</div>
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}
