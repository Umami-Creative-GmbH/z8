"use client";

import {
	type Icon,
	IconBuilding,
	IconCalendarEvent,
	IconPlus,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { AssignmentLevelCardHeader } from "@/components/settings/assignment-level-card-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type HolidayAssignmentType = "organization" | "team" | "employee";

interface AssignmentTarget {
	assignmentType: HolidayAssignmentType;
	team: {
		id: string;
		name: string;
	} | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

export interface PresetAssignmentData extends AssignmentTarget {
	id: string;
	presetId: string;
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	preset: {
		id: string;
		name: string;
		year: number | null;
		color: string | null;
		countryCode: string | null;
		stateCode: string | null;
	};
}

export interface HolidayAssignmentData extends AssignmentTarget {
	id: string;
	holidayId: string;
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	holiday: {
		id: string;
		name: string;
		description: string | null;
		startDate: Date;
		endDate: Date;
		recurrenceType: string;
	};
}

export interface HolidayCategoryAssignmentData extends AssignmentTarget {
	id: string;
	categoryId: string;
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
	};
}

/** The preset, single-holiday and holiday-category assignments of one assignment level. */
export interface HolidayLevelAssignments {
	presets: PresetAssignmentData[];
	holidays: HolidayAssignmentData[];
	categories: HolidayCategoryAssignmentData[];
}

export interface HolidayLevelCardProps {
	assignments: HolidayLevelAssignments;
	canManage: boolean;
	onAssignPresetClick: () => void;
	onAssignHolidayClick: () => void;
	onDeletePresetClick: (assignment: PresetAssignmentData) => void;
	onDeleteHolidayClick: (assignment: HolidayAssignmentData) => void;
	onDeleteHolidayCategoryClick: (assignment: HolidayCategoryAssignmentData) => void;
}

/** Formats a preset assignment's effective window, e.g. "Jan 1, 2026 to Open ended". */
function useAssignmentRangeFormatter() {
	const { t } = useTranslate();
	const locale = useLocale();
	const assignmentDateFormatter = Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeZone: "UTC",
	});

	return (effectiveFrom: Date | null, effectiveUntil: Date | null) => {
		if (!effectiveFrom && !effectiveUntil) {
			return t("settings.holidays.assignments.always", "Always");
		}
		const from = effectiveFrom
			? assignmentDateFormatter.format(effectiveFrom)
			: t("common.start", "Start");
		const until = effectiveUntil
			? assignmentDateFormatter.format(effectiveUntil)
			: t("common.openEnded", "Open ended");
		return t("settings.holidays.assignments.range", "{from} to {until}", {
			from,
			until,
		});
	};
}

/** Formats a holiday's day span, e.g. "Dec 24" or "Dec 24 to Dec 26". */
function useHolidayDateRangeFormatter() {
	const { t } = useTranslate();
	const locale = useLocale();
	const holidayDateFormatter = Intl.DateTimeFormat(locale, {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});

	return (startDate: Date | string, endDate: Date | string) => {
		const start = holidayDateFormatter.format(new Date(startDate));
		const end = holidayDateFormatter.format(new Date(endDate));
		return start === end
			? start
			: t("settings.holidays.assignments.range", "{from} to {until}", {
					from: start,
					until: end,
				});
	};
}

function customHolidayCount(assignments: HolidayLevelAssignments) {
	return assignments.categories.length + assignments.holidays.length;
}

function employeeLabel(employee: AssignmentTarget["employee"]) {
	return `${employee?.firstName ?? ""} ${employee?.lastName ?? ""}`.trim();
}

function RemoveAssignmentButton({
	canManage,
	label,
	onClick,
}: {
	canManage: boolean;
	label: string;
	onClick: () => void;
}) {
	return canManage ? (
		<Button
			variant="ghost"
			size="icon"
			className="size-8 text-muted-foreground hover:text-destructive"
			onClick={onClick}
			aria-label={label}
		>
			<IconTrash className="size-4" />
		</Button>
	) : null;
}

function AssignmentRow({ action, children }: { action: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
			<div className="flex items-center gap-3">{children}</div>
			{action}
		</div>
	);
}

function PresetYearBadge({ year }: { year: number | null }) {
	const { t } = useTranslate();
	const label = year ? t("settings.holidays.presets.yearValue", "Year {year}", { year }) : null;

	return label ? (
		<Badge variant="outline" className="ml-2">
			{label}
		</Badge>
	) : null;
}

function CategoryBadges({ type }: { type: string }) {
	const { t } = useTranslate();

	return (
		<>
			<Badge variant="outline" className="ml-2">
				{t("settings.holidays.assignments.categoryBadge", "Category")}
			</Badge>
			<Badge variant="secondary" className="ml-2 capitalize">
				{type}
			</Badge>
		</>
	);
}

function SingleHolidayBadge() {
	const { t } = useTranslate();

	return (
		<Badge variant="outline" className="ml-2">
			{t("settings.holidays.assignments.singleHolidayBadge", "Single holiday")}
		</Badge>
	);
}

function SectionHeading({ children, action }: { children: ReactNode; action: ReactNode }) {
	return (
		<div className="flex items-center justify-between mb-2">
			<h4 className="text-sm font-medium text-muted-foreground">{children}</h4>
			{action}
		</div>
	);
}

function EmptyOrganizationSection({ children }: { children: ReactNode }) {
	return (
		<p className="text-sm text-muted-foreground text-center py-2 border rounded-lg bg-muted/30">
			{children}
		</p>
	);
}

function OrganizationPresetRow({
	assignment,
	canManage,
	onDeleteClick,
}: {
	assignment: PresetAssignmentData;
	canManage: boolean;
	onDeleteClick: (assignment: PresetAssignmentData) => void;
}) {
	const { t } = useTranslate();
	const formatAssignmentRange = useAssignmentRangeFormatter();
	const { preset } = assignment;

	return (
		<AssignmentRow
			action={
				<RemoveAssignmentButton
					canManage={canManage}
					onClick={() => onDeleteClick(assignment)}
					label={t(
						"settings.holidays.assignments.removePresetAssignment",
						'Remove preset assignment for "{preset}"',
						{ preset: preset.name },
					)}
				/>
			}
		>
			{preset.color && (
				<div className="size-3 rounded-full shrink-0" style={{ backgroundColor: preset.color }} />
			)}
			<div>
				<span className="font-medium">{preset.name}</span>
				<PresetYearBadge year={preset.year} />
				{preset.countryCode && (
					<span className="text-sm text-muted-foreground ml-2">
						({preset.countryCode}
						{preset.stateCode && `-${preset.stateCode}`})
					</span>
				)}
				<p className="text-sm text-muted-foreground">
					{formatAssignmentRange(assignment.effectiveFrom, assignment.effectiveUntil)}
				</p>
			</div>
		</AssignmentRow>
	);
}

function OrganizationCategoryRow({
	assignment,
	canManage,
	onDeleteClick,
}: {
	assignment: HolidayCategoryAssignmentData;
	canManage: boolean;
	onDeleteClick: (assignment: HolidayCategoryAssignmentData) => void;
}) {
	const { t } = useTranslate();
	const { category } = assignment;

	return (
		<AssignmentRow
			action={
				<RemoveAssignmentButton
					canManage={canManage}
					onClick={() => onDeleteClick(assignment)}
					label={t(
						"settings.holidays.assignments.removeHolidayCategoryAssignment",
						'Remove holiday category assignment for "{category}"',
						{ category: category.name },
					)}
				/>
			}
		>
			{category.color ? (
				<span
					className="size-3 rounded-full shrink-0"
					style={{
						backgroundColor: category.color,
					}}
				/>
			) : (
				<IconCalendarEvent className="size-4 text-muted-foreground" />
			)}
			<div>
				<span className="font-medium">{category.name}</span>
				<CategoryBadges type={category.type} />
			</div>
		</AssignmentRow>
	);
}

function OrganizationHolidayRow({
	assignment,
	canManage,
	onDeleteClick,
}: {
	assignment: HolidayAssignmentData;
	canManage: boolean;
	onDeleteClick: (assignment: HolidayAssignmentData) => void;
}) {
	const { t } = useTranslate();
	const formatDateRange = useHolidayDateRangeFormatter();
	const { holiday } = assignment;

	return (
		<AssignmentRow
			action={
				<RemoveAssignmentButton
					canManage={canManage}
					onClick={() => onDeleteClick(assignment)}
					label={t(
						"settings.holidays.assignments.removeHolidayAssignment",
						'Remove holiday assignment for "{holiday}"',
						{ holiday: holiday.name },
					)}
				/>
			}
		>
			<IconCalendarEvent className="size-4 text-muted-foreground" />
			<div>
				<span className="font-medium">{holiday.name}</span>
				<SingleHolidayBadge />
				<span className="text-sm text-muted-foreground ml-2">
					({formatDateRange(holiday.startDate, holiday.endDate)})
				</span>
			</div>
		</AssignmentRow>
	);
}

export function OrganizationLevelCard({
	assignments,
	canManage,
	onAssignPresetClick,
	onAssignHolidayClick,
	onDeletePresetClick,
	onDeleteHolidayClick,
	onDeleteHolidayCategoryClick,
}: HolidayLevelCardProps) {
	const { t } = useTranslate();
	const customCount = customHolidayCount(assignments);

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconBuilding}
				title={t("settings.holidays.assignments.orgLevel", "Organization Level")}
				description={t(
					"settings.holidays.assignments.orgLevelDescription",
					"Default holidays applied to all employees unless overridden",
				)}
			/>
			<CardContent className="space-y-4">
				{/* Preset Assignment */}
				<div>
					<SectionHeading
						action={
							canManage && (
								<Button onClick={onAssignPresetClick} size="sm" variant="outline">
									<IconPlus className="mr-2 size-4" />
									{t("settings.holidays.assignments.setDefault", "Set Default")}
								</Button>
							)
						}
					>
						{t("settings.holidays.assignments.presetSection", "Holiday Preset")}
					</SectionHeading>
					{assignments.presets.length > 0 ? (
						<div className="space-y-2">
							{assignments.presets.map((assignment) => (
								<OrganizationPresetRow
									key={assignment.id}
									assignment={assignment}
									canManage={canManage}
									onDeleteClick={onDeletePresetClick}
								/>
							))}
						</div>
					) : (
						<EmptyOrganizationSection>
							{t("settings.holidays.assignments.noOrgPreset", "No default preset set")}
						</EmptyOrganizationSection>
					)}
				</div>

				<Separator />

				{/* Custom Holiday Assignments */}
				<div>
					<SectionHeading
						action={
							canManage ? (
								<Button onClick={onAssignHolidayClick} size="sm" variant="outline">
									<IconPlus className="mr-2 size-4" />
									{t("settings.holidays.assignments.addHolidayCategory", "Add Category")}
								</Button>
							) : null
						}
					>
						{t("settings.holidays.assignments.customHolidays", "Custom Holidays")}
						{customCount > 0 && (
							<Badge variant="secondary" className="ml-2">
								{customCount}
							</Badge>
						)}
					</SectionHeading>
					{customCount > 0 ? (
						<div className="space-y-2">
							{assignments.categories.map((assignment) => (
								<OrganizationCategoryRow
									key={`category-${assignment.id}`}
									assignment={assignment}
									canManage={canManage}
									onDeleteClick={onDeleteHolidayCategoryClick}
								/>
							))}
							{assignments.holidays.map((assignment) => (
								<OrganizationHolidayRow
									key={`holiday-${assignment.id}`}
									assignment={assignment}
									canManage={canManage}
									onDeleteClick={onDeleteHolidayClick}
								/>
							))}
						</div>
					) : (
						<EmptyOrganizationSection>
							{t(
								"settings.holidays.assignments.noOrgHolidays",
								"No custom holidays assigned to organization",
							)}
						</EmptyOrganizationSection>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

/** A team or employee assignment row: the target, an arrow, then what is assigned to it. */
function TargetAssignmentRow({
	icon: TargetIcon,
	targetName,
	action,
	children,
}: {
	icon: Icon;
	targetName: ReactNode;
	action: ReactNode;
	children: ReactNode;
}) {
	return (
		<AssignmentRow action={action}>
			<TargetIcon className="size-4 text-muted-foreground" />
			<div>
				<span className="font-medium">{targetName}</span>
				<span className="text-muted-foreground mx-2">→</span>
				{children}
			</div>
		</AssignmentRow>
	);
}

function TargetPresetContent({ assignment }: { assignment: PresetAssignmentData }) {
	const formatAssignmentRange = useAssignmentRangeFormatter();
	const { preset } = assignment;

	return (
		<>
			<span className="text-sm">
				{preset.name}
				<PresetYearBadge year={preset.year} />
				{preset.color && (
					<span
						className="inline-block size-2 rounded-full ml-2"
						style={{
							backgroundColor: preset.color,
						}}
					/>
				)}
			</span>
			<p className="text-sm text-muted-foreground">
				{formatAssignmentRange(assignment.effectiveFrom, assignment.effectiveUntil)}
			</p>
		</>
	);
}

function TargetCategoryContent({ assignment }: { assignment: HolidayCategoryAssignmentData }) {
	const { category } = assignment;

	return (
		<span className="text-sm">
			{category.color && (
				<span
					className="inline-block size-2 rounded-full mr-2"
					style={{
						backgroundColor: category.color,
					}}
				/>
			)}
			{category.name}
			<CategoryBadges type={category.type} />
		</span>
	);
}

function TargetHolidayContent({ assignment }: { assignment: HolidayAssignmentData }) {
	const formatDateRange = useHolidayDateRangeFormatter();
	const { holiday } = assignment;

	return (
		<span className="text-sm">
			{holiday.name}
			<SingleHolidayBadge />
			<span className="text-muted-foreground ml-1">
				({formatDateRange(holiday.startDate, holiday.endDate)})
			</span>
		</span>
	);
}

interface TargetLevelTabsProps {
	presetCount: number;
	customCount: number;
	canManage: boolean;
	onAssignPresetClick: () => void;
	onAssignHolidayClick: () => void;
	assignPresetLabel: string;
	noPresetsLabel: string;
	noHolidaysLabel: string;
	presetRows: ReactNode;
	categoryRows: ReactNode;
	holidayRows: ReactNode;
}

function AssignButton({
	canManage,
	onClick,
	children,
}: {
	canManage: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return canManage ? (
		<div className="flex justify-end mb-2">
			<Button onClick={onClick} size="sm" variant="outline">
				<IconPlus className="mr-2 size-4" />
				{children}
			</Button>
		</div>
	) : null;
}

function CountBadge({ count }: { count: number }) {
	return count > 0 ? (
		<Badge variant="secondary" className="ml-2">
			{count}
		</Badge>
	) : null;
}

/** The preset and custom-holiday tabs of the team and employee level cards. */
function TargetLevelTabs({
	presetCount,
	customCount,
	canManage,
	onAssignPresetClick,
	onAssignHolidayClick,
	assignPresetLabel,
	noPresetsLabel,
	noHolidaysLabel,
	presetRows,
	categoryRows,
	holidayRows,
}: TargetLevelTabsProps) {
	const { t } = useTranslate();

	return (
		<Tabs defaultValue="presets" className="w-full">
			<TabsList className="grid w-full grid-cols-2">
				<TabsTrigger value="presets">
					{t("settings.holidays.assignments.presets", "Presets")}
					<CountBadge count={presetCount} />
				</TabsTrigger>
				<TabsTrigger value="holidays">
					{t("settings.holidays.assignments.holidays", "Custom Holidays")}
					<CountBadge count={customCount} />
				</TabsTrigger>
			</TabsList>
			<TabsContent value="presets" className="mt-4">
				<AssignButton canManage={canManage} onClick={onAssignPresetClick}>
					{assignPresetLabel}
				</AssignButton>
				{presetCount > 0 ? (
					<div className="space-y-2">{presetRows}</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">{noPresetsLabel}</p>
				)}
			</TabsContent>
			<TabsContent value="holidays" className="mt-4">
				<AssignButton canManage={canManage} onClick={onAssignHolidayClick}>
					{t("settings.holidays.assignments.assignCategory", "Assign Category")}
				</AssignButton>
				{customCount > 0 ? (
					<div className="space-y-2">
						{categoryRows}
						{holidayRows}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">{noHolidaysLabel}</p>
				)}
			</TabsContent>
		</Tabs>
	);
}

export function TeamLevelCard({
	assignments,
	canManage,
	onAssignPresetClick,
	onAssignHolidayClick,
	onDeletePresetClick,
	onDeleteHolidayClick,
	onDeleteHolidayCategoryClick,
}: HolidayLevelCardProps) {
	const { t } = useTranslate();
	const presetCount = assignments.presets.length;
	const customCount = customHolidayCount(assignments);

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconUsers}
				title={t("settings.holidays.assignments.teamLevel", "Team Level")}
				description={t(
					"settings.holidays.assignments.teamLevelDescription",
					"Override organization defaults for specific teams",
				)}
				count={presetCount + customCount}
			/>
			<CardContent>
				<TargetLevelTabs
					presetCount={presetCount}
					customCount={customCount}
					canManage={canManage}
					onAssignPresetClick={onAssignPresetClick}
					onAssignHolidayClick={onAssignHolidayClick}
					assignPresetLabel={t("settings.holidays.assignments.assignTeam", "Assign Preset")}
					noPresetsLabel={t(
						"settings.holidays.assignments.noTeamPresets",
						"No team preset assignments",
					)}
					noHolidaysLabel={t(
						"settings.holidays.assignments.noTeamHolidays",
						"No team holiday assignments",
					)}
					presetRows={assignments.presets.map((assignment) => (
						<TargetAssignmentRow
							key={assignment.id}
							icon={IconUsers}
							targetName={assignment.team?.name}
							action={
								<RemoveAssignmentButton
									canManage={canManage}
									onClick={() => onDeletePresetClick(assignment)}
									label={t(
										"settings.holidays.assignments.removeTeamPresetAssignment",
										'Remove preset assignment for team "{team}"',
										{ team: assignment.team?.name ?? "" },
									)}
								/>
							}
						>
							<TargetPresetContent assignment={assignment} />
						</TargetAssignmentRow>
					))}
					categoryRows={assignments.categories.map((assignment) => (
						<TargetAssignmentRow
							key={`category-${assignment.id}`}
							icon={IconUsers}
							targetName={assignment.team?.name}
							action={
								<RemoveAssignmentButton
									canManage={canManage}
									onClick={() => onDeleteHolidayCategoryClick(assignment)}
									label={t(
										"settings.holidays.assignments.removeTeamHolidayCategoryAssignment",
										'Remove holiday category assignment for team "{team}"',
										{ team: assignment.team?.name ?? "" },
									)}
								/>
							}
						>
							<TargetCategoryContent assignment={assignment} />
						</TargetAssignmentRow>
					))}
					holidayRows={assignments.holidays.map((assignment) => (
						<TargetAssignmentRow
							key={`holiday-${assignment.id}`}
							icon={IconUsers}
							targetName={assignment.team?.name}
							action={
								<RemoveAssignmentButton
									canManage={canManage}
									onClick={() => onDeleteHolidayClick(assignment)}
									label={t(
										"settings.holidays.assignments.removeTeamHolidayAssignment",
										'Remove holiday assignment for team "{team}"',
										{ team: assignment.team?.name ?? "" },
									)}
								/>
							}
						>
							<TargetHolidayContent assignment={assignment} />
						</TargetAssignmentRow>
					))}
				/>
			</CardContent>
		</Card>
	);
}

function EmployeeName({ employee }: { employee: AssignmentTarget["employee"] }) {
	return (
		<>
			{employee?.firstName} {employee?.lastName}
		</>
	);
}

export function EmployeeLevelCard({
	assignments,
	canManage,
	onAssignPresetClick,
	onAssignHolidayClick,
	onDeletePresetClick,
	onDeleteHolidayClick,
	onDeleteHolidayCategoryClick,
}: HolidayLevelCardProps) {
	const { t } = useTranslate();
	const presetCount = assignments.presets.length;
	const customCount = customHolidayCount(assignments);

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconUser}
				title={t("settings.holidays.assignments.employeeLevel", "Employee Overrides")}
				description={t(
					"settings.holidays.assignments.employeeLevelDescription",
					"Override team or organization defaults for specific employees",
				)}
				count={presetCount + customCount}
			/>
			<CardContent>
				<TargetLevelTabs
					presetCount={presetCount}
					customCount={customCount}
					canManage={canManage}
					onAssignPresetClick={onAssignPresetClick}
					onAssignHolidayClick={onAssignHolidayClick}
					assignPresetLabel={t("settings.holidays.assignments.assignEmployee", "Assign Preset")}
					noPresetsLabel={t(
						"settings.holidays.assignments.noEmployeePresets",
						"No employee preset overrides",
					)}
					noHolidaysLabel={t(
						"settings.holidays.assignments.noEmployeeHolidays",
						"No employee holiday overrides",
					)}
					presetRows={assignments.presets.map((assignment) => (
						<TargetAssignmentRow
							key={assignment.id}
							icon={IconUser}
							targetName={<EmployeeName employee={assignment.employee} />}
							action={
								<RemoveAssignmentButton
									canManage={canManage}
									onClick={() => onDeletePresetClick(assignment)}
									label={t(
										"settings.holidays.assignments.removeEmployeePresetAssignment",
										'Remove preset assignment for employee "{employee}"',
										{ employee: employeeLabel(assignment.employee) },
									)}
								/>
							}
						>
							<TargetPresetContent assignment={assignment} />
						</TargetAssignmentRow>
					))}
					categoryRows={assignments.categories.map((assignment) => (
						<TargetAssignmentRow
							key={`category-${assignment.id}`}
							icon={IconUser}
							targetName={<EmployeeName employee={assignment.employee} />}
							action={
								<RemoveAssignmentButton
									canManage={canManage}
									onClick={() => onDeleteHolidayCategoryClick(assignment)}
									label={t(
										"settings.holidays.assignments.removeEmployeeHolidayCategoryAssignment",
										'Remove holiday category assignment for employee "{employee}"',
										{ employee: employeeLabel(assignment.employee) },
									)}
								/>
							}
						>
							<TargetCategoryContent assignment={assignment} />
						</TargetAssignmentRow>
					))}
					holidayRows={assignments.holidays.map((assignment) => (
						<TargetAssignmentRow
							key={`holiday-${assignment.id}`}
							icon={IconUser}
							targetName={<EmployeeName employee={assignment.employee} />}
							action={
								<RemoveAssignmentButton
									canManage={canManage}
									onClick={() => onDeleteHolidayClick(assignment)}
									label={t(
										"settings.holidays.assignments.removeEmployeeHolidayAssignment",
										'Remove holiday assignment for employee "{employee}"',
										{ employee: employeeLabel(assignment.employee) },
									)}
								/>
							}
						>
							<TargetHolidayContent assignment={assignment} />
						</TargetAssignmentRow>
					))}
				/>
			</CardContent>
		</Card>
	);
}
