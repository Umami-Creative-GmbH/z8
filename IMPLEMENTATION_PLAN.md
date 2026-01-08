# Z8 Webapp Implementation Plan - 5 Core Topics

This comprehensive plan outlines the strategic approach to advance the Z8 time tracking webapp from its current foundation toward production-ready status. Each topic represents a critical area for GoBD compliance, data integrity, and feature completeness.

---

## 1. GoBD-Compliant Hashing & Blockchain-Style Immutability

### Current State
- **Database Schema**: ✅ Ready - `timeEntry` table includes:
  - `hash`: SHA256 or similar for entry integrity
  - `previousHash`: Links to prior entry (blockchain pattern)
  - `previousEntryId`: References previous entry in chain
  - `replacesEntryId`: Tracks corrections (not deletions)
  - `isSuperseded`: Boolean marking if entry was corrected
  - `supersededById`: Points to replacement entry

- **Application Layer**: ❌ Missing - No hash calculation logic implemented

### Implementation Tasks

#### 1.1 Create Hash Calculation Service
**File**: `apps/webapp/src/lib/time-tracking/hash.service.ts`

**Responsibilities**:
- Implement SHA256 hashing using Node.js `crypto` module
- Hash entry data in deterministic order: `{employeeId}|{type}|{timestamp}|{previousHash}`
- Ensure hash is immutable after creation
- Provide hash verification function

**Example interface**:
```typescript
export interface HashableEntry {
  employeeId: string;
  type: 'clock_in' | 'clock_out' | 'correction';
  timestamp: Date;
  previousHash?: string;
  notes?: string;
  location?: string;
}

export async function calculateHash(entry: HashableEntry): Promise<string> {}
export async function verifyHash(entry: HashableEntry, hash: string): Promise<boolean> {}
export async function getChainHash(entries: TimeEntry[]): Promise<string> {}
```

#### 1.2 Create TimeEntry Service with Hashing
**File**: `apps/webapp/src/lib/time-tracking/entry.service.ts`

**Responsibilities**:
- Fetch previous entry for an employee
- Calculate hash incorporating previous hash (chain linking)
- Create time entry with hash verification
- Validate chain integrity (no gaps, all hashes consistent)

**Key functions**:
```typescript
export async function createTimeEntry(input: {
  employeeId: string;
  type: TimeEntryType;
  timestamp: Date;
  notes?: string;
  location?: string;
  ipAddress?: string;
  deviceInfo?: string;
}): Promise<TimeEntry> {}

export async function verifyTimeEntryChain(employeeId: string): Promise<{
  isValid: boolean;
  issues: string[];
}> {}

export async function createCorrectionEntry(input: {
  employeeId: string;
  replacesEntryId: string;
  timestamp: Date;
  notes: string;
  approverId: string;
}): Promise<TimeEntry> {}
```

#### 1.3 API Routes for Time Entry Management
**File**: `apps/webapp/src/app/api/time-entries/route.ts`

**Endpoints**:
- `POST /api/time-entries` - Clock in/out with hash generation
- `GET /api/time-entries?employeeId=X&from=X&to=X` - Retrieve chain
- `POST /api/time-entries/verify` - Verify chain integrity
- `POST /api/time-entries/corrections` - Submit correction (requires approval)

#### 1.4 Update Dashboard to Show Hash Verification Status
**File**: `apps/webapp/src/components/dashboard/time-entry-widget.tsx`

**Display**:
- ✅ Valid chain badge next to employee name
- ⚠️ Warning if chain integrity check fails
- Last verified timestamp
- Link to full chain audit view

#### 1.5 Write Unit Tests
**File**: `apps/webapp/src/lib/time-tracking/__tests__/hash.service.test.ts`

**Test Cases**:
- Hash consistency (same input = same hash)
- Hash changes when data modified
- Chain validation with valid sequence
- Chain validation with broken links
- Hash verification with tampered data

---

## 2. Replace Hardcoded Organization IDs with Dynamic Session Data

### Current State
- **Auth Context**: ✅ Available in `auth-helpers.ts`
  - `getAuthContext()` provides `activeOrganizationId`
  - Returns full employee context with role
  
- **Issue**: Pages may use hardcoded/placeholder organization IDs instead of reading from session

### Implementation Tasks

#### 2.1 Audit Hardcoded References
**Search Pattern**: `organizationId.*=.*['"](org_|uuid pattern)`

**Action Items**:
- Identify all hardcoded organization IDs
- Map which pages/components use them
- Document impact (affects multi-tenancy)

#### 2.2 Create Organization Context Hook
**File**: `apps/webapp/src/hooks/use-organization.ts`

```typescript
export function useOrganization() {
  const [context, setContext] = useState<AuthContext | null>(null);
  
  useEffect(() => {
    getAuthContext().then(setContext);
  }, []);
  
  return {
    organizationId: context?.session.activeOrganizationId,
    employee: context?.employee,
    isLoading: context === null,
    isAdmin: context?.employee?.role === 'admin',
  };
}
```

#### 2.3 Update Dashboard Pages
**Files to Update**:
- `apps/webapp/src/app/[locale]/(dashboard)/page.tsx`
- `apps/webapp/src/app/[locale]/dashboard/team/page.tsx`
- `apps/webapp/src/app/[locale]/dashboard/absences/page.tsx`
- `apps/webapp/src/app/[locale]/dashboard/analytics/page.tsx`

**Changes**:
```typescript
// Before
const ORGANIZATION_ID = 'hardcoded-uuid';

// After
export default async function DashboardPage() {
  const context = await getAuthContext();
  if (!context?.session.activeOrganizationId) {
    redirect('/');
  }
  
  const organizationId = context.session.activeOrganizationId;
  // Use dynamic organizationId
}
```

#### 2.4 Update Data Fetching Queries
**Files to Update**:
- All server actions that fetch employee/team data
- All database queries in API routes
- All widget data hooks

**Pattern**:
```typescript
// Add organizationId filter to all queries
const employees = await db.query.employee.findMany({
  where: and(
    eq(employee.organizationId, organizationId),
    eq(employee.isActive, true)
  ),
});
```

#### 2.5 Test Multi-Organization Isolation
**Test Cases**:
- User from Org A cannot see Org B's employees
- User cannot manipulate URL to access other org's data
- Dashboard shows correct org name/logo
- Team switching works correctly

---

## 3. Data-Driven Analytics Dashboards

### Current State
- **Components**: ✅ Exist in `apps/webapp/src/components/analytics/`
  - Chart components present
  - Export button implemented
  
- **Issue**: ❌ TODOs indicate missing calculations for:
  - Absence rates & trends
  - Team productivity metrics
  - Performance analytics

### Implementation Tasks

#### 3.1 Create Analytics Data Service
**File**: `apps/webapp/src/lib/analytics/analytics.service.ts`

**Key Calculations**:
```typescript
export async function getAbsenceMetrics(input: {
  organizationId: string;
  startDate: Date;
  endDate: Date;
  teamId?: string;
}): Promise<{
  totalAbsenceDays: number;
  absenceByCategory: { category: string; days: number }[];
  absenceRate: number; // % of working days
  topAbsenters: { employeeName: string; days: number }[];
}> {}

export async function getTeamMetrics(input: {
  organizationId: string;
  startDate: Date;
  endDate: Date;
}): Promise<{
  averageHoursPerWeek: number;
  teamSize: number;
  activeEmployees: number;
  pendingApprovals: number;
}> {}

export async function getPerformanceMetrics(input: {
  organizationId: string;
  startDate: Date;
  endDate: Date;
  teamId?: string;
}): Promise<{
  onTimeClockInRate: number; // %
  completionRate: number; // % of entries with end time
  averageSessionDuration: number; // minutes
  employeeMetrics: EmployeePerformance[];
}> {}

export async function getTrendData(input: {
  organizationId: string;
  metric: 'absences' | 'hours' | 'performance';
  granularity: 'daily' | 'weekly' | 'monthly';
  startDate: Date;
  endDate: Date;
}): Promise<{ date: Date; value: number }[]> {}
```

#### 3.2 Create Query Functions for Charts
**File**: `apps/webapp/src/lib/query/analytics.queries.ts`

**Queries**:
- `absencesByCategory()` - SQL aggregation by absence type
- `hoursByTeam()` - Hours worked grouped by team
- `employeeHoursOverTime()` - Time series per employee
- `absenceRatesByMonth()` - Monthly trends
- `pendingApprovalsCount()` - Count by category

#### 3.3 Update Dashboard Widgets
**Files to Update**:
- `apps/webapp/src/components/dashboard/quick-stats-widget.tsx`
- `apps/webapp/src/components/analytics/performance-chart.tsx`
- `apps/webapp/src/components/analytics/absence-trends-chart.tsx`
- `apps/webapp/src/components/analytics/team-overview-chart.tsx`

**Replace TODOs with actual service calls**:
```typescript
// Before
export async function QuickStatsWidget() {
  // TODO: Replace with real data
  const stats = { absenceRate: 0 };
  
// After
export async function QuickStatsWidget() {
  const context = await getAuthContext();
  const metrics = await getAbsenceMetrics({
    organizationId: context.session.activeOrganizationId!,
    startDate: startOfMonth(new Date()),
    endDate: endOfMonth(new Date()),
  });
  
  return <QuickStats data={metrics} />;
}
```

#### 3.4 Create API Route for Analytics Data
**File**: `apps/webapp/src/app/api/analytics/route.ts`

**Endpoints**:
- `GET /api/analytics/absences?org=X&from=X&to=X` - Absence data
- `GET /api/analytics/performance?org=X&from=X&to=X` - Performance metrics
- `GET /api/analytics/trends?org=X&metric=X&granularity=X` - Trend data

#### 3.5 Create Download/Export Functionality
**File**: `apps/webapp/src/lib/analytics/export.ts`

**Formats**:
- CSV export with full detail
- PDF report with charts
- Excel with multiple sheets
- JSON for integration

#### 3.6 Write Analytics Tests
**File**: `apps/webapp/src/lib/analytics/__tests__/analytics.service.test.ts`

**Test Cases**:
- Absence rate calculation (correct formula)
- Team metrics aggregation
- Time range filtering
- Multi-organization isolation

---

## 4. Harden Audit Logging Infrastructure

### Current State
- **Audit Logger**: ⚠️ Partial - `audit-logger.ts` exists with:
  - `logAudit()` function (logs to console/logger)
  - TODO at line 69: "Send to external audit logging service"
  - No persistent storage to database

- **Database**: ✅ Schema ready - `auditLog` table exists
  - Tracks entity changes with full context
  - Has performedBy, timestamp, ipAddress, userAgent

### Implementation Tasks

#### 4.1 Implement Database Persistence
**File**: `apps/webapp/src/lib/audit-logger.ts` (update `logAudit()`)

**Changes**:
```typescript
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  const logEntry = {
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  };

  logger.info(logEntry, `Audit: ${entry.action}`);

  // NEW: Persist to database
  try {
    await db.insert(auditLog).values({
      id: generateId(),
      entityType: entry.targetType || 'unknown',
      entityId: entry.targetId || '',
      action: entry.action,
      performedBy: entry.actorId,
      changes: JSON.stringify(entry.metadata),
      metadata: JSON.stringify({
        actorEmail: entry.actorEmail,
        targetType: entry.targetType,
      }),
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      timestamp: entry.timestamp,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to persist audit log');
    // Don't fail the operation if audit logging fails
  }
}
```

#### 4.2 Create Audit Log Queries
**File**: `apps/webapp/src/lib/query/audit.queries.ts`

```typescript
export async function getAuditLogs(input: {
  organizationId: string;
  entityType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}): Promise<AuditLog[]> {}

export async function getUserAuditTrail(userId: string, organizationId: string): Promise<AuditLog[]> {}

export async function getEntityAuditHistory(entityId: string): Promise<AuditLog[]> {}
```

#### 4.3 Create Audit Log Viewer Page
**File**: `apps/webapp/src/app/[locale]/dashboard/settings/audit-log/page.tsx`

**Features**:
- Table view of audit events
- Filter by date range, user, entity type
- Search by entity ID or action
- Export audit trail as CSV
- Pagination for large datasets

#### 4.4 Create IP/Device Tracking
**File**: `apps/webapp/src/lib/middleware/audit-context.ts`

**Middleware to**:
- Extract client IP address
- Capture User-Agent
- Store in request context
- Pass to audit logger

```typescript
export function getAuditContext(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
             request.headers.get('x-real-ip') ||
             'unknown';
  
  const userAgent = request.headers.get('user-agent') || 'unknown';
  
  return { ipAddress: ip, userAgent };
}
```

#### 4.5 Implement External Service Integration (Optional)
**File**: `apps/webapp/src/lib/audit-logger-external.ts`

**Support for**:
- DataDog integration (via API)
- Splunk integration (via HTTP event collector)
- AWS CloudTrail
- Generic webhook for custom systems

```typescript
export async function sendToExternalAuditService(entry: AuditLogEntry): Promise<void> {
  const service = process.env.AUDIT_SERVICE || 'datadog';
  
  switch (service) {
    case 'datadog':
      return sendToDataDog(entry);
    case 'splunk':
      return sendToSplunk(entry);
    default:
      return sendToWebhook(entry);
  }
}
```

#### 4.6 Create Audit Report Generator
**File**: `apps/webapp/src/lib/analytics/audit-report.ts`

**Reports**:
- Daily audit summary
- User activity report
- Change log by entity
- Compliance report for auditors
- Access pattern analysis

#### 4.7 Write Audit Tests
**File**: `apps/webapp/src/lib/__tests__/audit-logger.test.ts`

**Test Cases**:
- Log persists to database
- IP address captured correctly
- Multi-organization isolation (logs don't leak)
- Concurrent logging doesn't cause conflicts

---

## 5. Implement Vacation Carryover Logic

### Current State
- **Database Schema**: ✅ Complete
  - `vacationAllowance`: Organization policy (allowCarryover, maxCarryoverDays, carryoverExpiryMonths)
  - `employeeVacationAllowance`: Per-employee override with carryover tracking
  - `absenceEntry`: Tracks actual vacation taken
  
- **Application Logic**: ❌ Missing
  - No carryover calculation
  - No expiry enforcement
  - No accrual logic

### Implementation Tasks

#### 5.1 Create Vacation Service with Carryover Logic
**File**: `apps/webapp/src/lib/absences/vacation.service.ts`

```typescript
export async function getVacationBalance(input: {
  employeeId: string;
  year: number;
}): Promise<{
  totalAllowance: number;
  used: number;
  remaining: number;
  carryover: number;
  carryoverExpiring: number;
  available: number; // remaining + valid carryover
}> {}

export async function calculateAnnualCarryover(organizationId: string, fromYear: number): Promise<CarryoverResult[]> {
  // 1. Get vacationAllowance policy
  // 2. For each employee, calculate:
  //    a. Used vacation in fromYear
  //    b. Remaining balance
  //    c. Apply carryover rules
  //    d. Calculate expiry date
  // 3. Store in employeeVacationAllowance for new year
}

export async function expireCarryoverDays(organizationId: string): Promise<{
  employeesAffected: number;
  daysExpired: number;
}> {
  // Find all carryover entries past their expiry date
  // Mark as expired/used
  // Log action in audit trail
}

export async function accrueVacationDays(organizationId: string, month: number): Promise<void> {
  // Based on accrualType (annual, monthly, biweekly)
  // Calculate and add prorated days
  // For employees hired mid-year, handle proration
}

export async function requestVacation(input: {
  employeeId: string;
  startDate: Date;
  endDate: Date;
  notes?: string;
}): Promise<{ requestId: string; daysRequested: number }> {
  // 1. Validate employee has enough balance
  // 2. Create absence entry with vacation category
  // 3. Route to manager for approval
  // 4. Don't deduct balance until approved
}
```

#### 5.2 Create Vacation Database Queries
**File**: `apps/webapp/src/lib/query/vacation.queries.ts`

```typescript
export async function getVacationTakenInYear(employeeId: string, year: number): Promise<number> {}
export async function getCarryoverBalance(employeeId: string, year: number): Promise<{ balance: number; expiresAt: Date }[]> {}
export async function getPendingVacationRequests(organizationId: string): Promise<PendingRequest[]> {}
export async function getVacationAuditTrail(employeeId: string): Promise<VacationEvent[]> {}
```

#### 5.3 Update Vacation Allowance Configuration UI
**File**: `apps/webapp/src/components/settings/vacation-policy.tsx`

**Form Fields**:
- Default annual vacation days
- Accrual type (annual/monthly/biweekly)
- Accrual start month
- Allow carryover (checkbox)
- Max carryover days
- Carryover expiry months

#### 5.4 Create Vacation Request Workflow
**File**: `apps/webapp/src/app/[locale]/dashboard/absences/request-vacation/page.tsx`

**Flow**:
1. Employee selects date range
2. System calculates working days (exclude weekends/holidays)
3. Show balance available
4. Warn if insufficient balance
5. Submit for manager approval
6. Manager reviews and approves/rejects
7. On approval, deduct from balance

#### 5.5 Create Carryover Automation Job
**File**: `apps/webapp/src/lib/jobs/carryover-automation.ts`

**Scheduled Task** (runs Jan 1 or accrual start month):
```typescript
export async function runAnnualCarryover() {
  const organizations = await db.query.organization.findMany();
  
  for (const org of organizations) {
    const policy = await getVacationAllowance(org.id, new Date().getFullYear());
    
    if (policy?.allowCarryover) {
      await calculateAnnualCarryover(org.id, new Date().getFullYear() - 1);
    }
    
    // Clean up expired carryover
    await expireCarryoverDays(org.id);
  }
}
```

**Integration**:
- Wire to cron job or Vercel Cron Functions
- Add error handling and notifications
- Log completion for audit trail

#### 5.6 Create Vacation Dashboard Widgets
**File**: `apps/webapp/src/components/dashboard/vacation-balance-widget.tsx`

**Display**:
- Vacation days available
- Days used this year
- Carryover balance (if applicable)
- Expiry date of carryover
- Progress bar showing balance

#### 5.7 Create Vacation Reports
**File**: `apps/webapp/src/lib/reporting/vacation-reports.ts`

**Reports**:
- Team vacation calendar
- Individual vacation balance per employee
- Upcoming expirations
- Carryover history
- Accrual projection

#### 5.8 Write Vacation Service Tests
**File**: `apps/webapp/src/lib/absences/__tests__/vacation.service.test.ts`

**Test Cases**:
- Correct balance calculation
- Carryover applied correctly
- Expiry dates enforced
- Accrual calculation (monthly/biweekly)
- Multi-year scenarios
- Part-time employee prorating

---

## Implementation Sequence & Dependencies

### Phase 1: Foundation (Weeks 1-2)
**Priority: High - Blocking other phases**
1. Task 2.1-2.2: Audit and create organization context hook
2. Task 1.1: Create hash calculation service
3. Task 4.1-4.2: Database persistence and audit queries

### Phase 2: Core Features (Weeks 3-4)
**Priority: High - Core compliance requirements**
1. Task 1.2-1.3: TimeEntry service and API routes
2. Task 3.1-3.2: Analytics service and queries
3. Task 5.1-5.2: Vacation service and queries

### Phase 3: UI & Integration (Weeks 5-6)
**Priority: Medium - User-facing features**
1. Task 2.3-2.5: Update dashboard pages and test isolation
2. Task 3.3-3.6: Update charts, export, and analytics page
3. Task 4.3-4.5: Audit viewer page and external integration

### Phase 4: Automation & Polish (Weeks 7-8)
**Priority: Medium - Production readiness**
1. Task 5.3-5.8: Vacation UI, automation, reports
2. Task 1.4-1.5: Dashboard hash verification display and tests
3. All unit and integration tests

---

## Success Criteria

### GoBD Compliance (Topic 1)
- ✅ All time entries have valid SHA256 hashes
- ✅ Hash chain unbroken for each employee
- ✅ Corrections create new entries, never delete
- ✅ Verification tool shows chain integrity status
- ✅ Audit log tracks all changes

### Multi-Tenancy (Topic 2)
- ✅ Zero hardcoded organization IDs in code
- ✅ All queries include organizationId filter
- ✅ User cannot access other organization's data
- ✅ Dashboard shows correct org context
- ✅ Team switching works seamlessly

### Analytics (Topic 3)
- ✅ All dashboard charts show real data
- ✅ No TODO placeholders remain
- ✅ Charts update within 5 minutes of data change
- ✅ Export works in CSV, PDF, Excel formats
- ✅ Performance acceptable (<500ms query time)

### Audit Logging (Topic 4)
- ✅ All actions logged to auditLog table
- ✅ Audit log viewer accessible to admins
- ✅ Logs include IP address and user agent
- ✅ External service integration working (if enabled)
- ✅ 90-day retention policy enforced

### Vacation Management (Topic 5)
- ✅ Carryover calculated correctly on year boundary
- ✅ Expiry enforced automatically
- ✅ Balance includes valid carryover
- ✅ Requests route through approval workflow
- ✅ Reports show accurate balances

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking existing time entry creation | Create new `timeEntryWithHash` function, deprecate old one gradually |
| Performance impact of hash calculation | Cache previous hash, batch operations in off-peak hours |
| Analytics queries timeout on large datasets | Implement pagination, pre-calculate metrics nightly |
| Carryover automation runs at wrong time | Add backup manual trigger in UI, detailed logging |
| Hash verification slows down APIs | Add async verification background job, return immediately |

---

## Related Documentation
- [README.md](README.md) - Project overview
- [USER_GUIDE.md](USER_GUIDE.md) - Feature documentation
- [Database Schema](apps/webapp/src/db/schema.ts) - Complete data model
