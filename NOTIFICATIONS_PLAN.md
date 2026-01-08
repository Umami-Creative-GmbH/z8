# Comprehensive Notification System Implementation Plan

## Overview
Build a multi-channel notification system for Z8 webapp with:
- In-app notifications (bell icon with dropdown inbox)
- Browser push notifications
- Enhanced email notifications
- User notification preferences
- Real-time updates via SSE
- Notification history with read/unread status

## Notification Events to Support
| Category | Events |
|----------|--------|
| **Approvals** | Request submitted, approved, rejected |
| **Time Corrections** | Submitted, approved, rejected |
| **Absences** | Submitted, approved, rejected |
| **Team** | Member added, member removed |
| **Security** | Password changed, 2FA enabled/disabled |
| **Reminders** | Birthday reminders, vacation balance alerts |

---

## Phase 1: Database Schema & Foundation

### 1.1 Add Database Tables
**File:** `apps/webapp/src/db/schema.ts`

Add enums and tables:
```typescript
// Enums
export const notificationTypeEnum = pgEnum("notification_type", [
  "approval_request_submitted", "approval_request_approved", "approval_request_rejected",
  "time_correction_submitted", "time_correction_approved", "time_correction_rejected",
  "absence_request_submitted", "absence_request_approved", "absence_request_rejected",
  "team_member_added", "team_member_removed",
  "password_changed", "two_factor_enabled", "two_factor_disabled",
  "birthday_reminder", "vacation_balance_alert",
]);

// Tables: notification, notificationPreference, pushSubscription
```

### 1.2 Run Migration
```bash
cd apps/webapp && bun drizzle-kit generate && bun drizzle-kit migrate
```

---

## Phase 2: Core Service & API Routes

### 2.1 Notification Service
**New file:** `apps/webapp/src/lib/notifications/notification-service.ts`
- `createNotification(params)` - Create and dispatch notification
- `markAsRead(id, userId)` - Mark single notification read
- `markAllAsRead(userId)` - Mark all notifications read
- `getUnreadCount(userId)` - Get badge count
- `getUserNotifications(userId, options)` - Paginated list

### 2.2 Notification Types
**New file:** `apps/webapp/src/lib/notifications/types.ts`
- TypeScript types for notifications
- Notification event payloads

### 2.3 API Routes
**New files:**
- `apps/webapp/src/app/api/notifications/route.ts` - GET list, PATCH mark read
- `apps/webapp/src/app/api/notifications/count/route.ts` - GET unread count
- `apps/webapp/src/app/api/notifications/stream/route.ts` - SSE real-time endpoint
- `apps/webapp/src/app/api/notifications/preferences/route.ts` - GET/PUT preferences

---

## Phase 3: In-App Notification UI

### 3.1 React Query Integration
**Modify:** `apps/webapp/src/lib/query/keys.ts`
```typescript
notifications: {
  all: ["notifications"] as const,
  list: (options?: { unreadOnly?: boolean }) => ["notifications", "list", options] as const,
  unreadCount: () => ["notifications", "unread-count"] as const,
  preferences: () => ["notifications", "preferences"] as const,
},
```

### 3.2 Hooks
**New files:**
- `apps/webapp/src/hooks/use-notifications.ts` - React Query hook for notifications list + unread count
- `apps/webapp/src/hooks/use-notification-stream.ts` - SSE connection hook for real-time updates

### 3.3 UI Components
**New files in** `apps/webapp/src/components/notifications/`:
- `notification-bell.tsx` - Bell icon button with unread badge
- `notification-popover.tsx` - Dropdown popover container
- `notification-list.tsx` - Scrollable list with virtualization
- `notification-item.tsx` - Single notification row (icon, title, message, time, actions)
- `notification-empty.tsx` - Empty state when no notifications

### 3.4 Header Integration
**Modify:** `apps/webapp/src/components/site-header.tsx`
- Import and add `<NotificationBell />` to header actions (between "Request Absence" button and TimeClockPopover)

---

## Phase 4: Notification Triggers

### 4.1 Trigger Functions
**New file:** `apps/webapp/src/lib/notifications/triggers.ts`
- `onAbsenceRequestSubmitted(absence, submitter, approver)`
- `onAbsenceRequestApproved(absence, approver)`
- `onAbsenceRequestRejected(absence, approver, reason)`
- `onTimeCorrectionSubmitted(workPeriod, submitter, approver)`
- `onTimeCorrectionApproved/Rejected(...)`
- `onTeamMemberAdded(team, member, addedBy)`
- `onPasswordChanged(user)`
- `onTwoFactorEnabled/Disabled(user)`

### 4.2 Integration Points
**Modify:** `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts`
- Add notification triggers to `approveAbsenceEffect`, `rejectAbsenceEffect`
- Add triggers to time correction approval actions

**Modify:** Absence request submission action
- Trigger notification to approver when request submitted

**Modify:** Team member management actions
- Trigger notifications when members added/removed

---

## Phase 5: Push Notifications

### 5.1 Service Worker
**New file:** `apps/webapp/public/sw.js`
- Handle push events
- Show browser notifications
- Handle notification click (open app to action URL)

### 5.2 VAPID Setup
**Environment variables:**
```env
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:support@yourdomain.com
```

### 5.3 Push API Routes
**New files:**
- `apps/webapp/src/app/api/notifications/push/vapid-key/route.ts` - GET public key
- `apps/webapp/src/app/api/notifications/push/subscribe/route.ts` - POST subscription
- `apps/webapp/src/app/api/notifications/push/unsubscribe/route.ts` - POST unsubscribe

### 5.4 Push Hook
**New file:** `apps/webapp/src/hooks/use-push-notifications.ts`
- Check browser support
- Request permission
- Subscribe/unsubscribe to push

### 5.5 Push Service
**New file:** `apps/webapp/src/lib/notifications/push-service.ts`
- Send push notifications using web-push library

---

## Phase 6: User Preferences

### 6.1 Preferences UI
**New file:** `apps/webapp/src/components/notifications/notification-settings.tsx`
- Toggle matrix: notification type vs channel (in-app, push, email)
- Email digest option

### 6.2 Settings Page
**New file:** `apps/webapp/src/app/[locale]/(app)/settings/notifications/page.tsx`
- Full-page notification preferences management

### 6.3 Settings Navigation
**Modify:** `apps/webapp/src/components/settings/settings-nav.tsx`
- Add "Notifications" link to settings navigation

---

## Phase 7: Enhanced Email Notifications

### 7.1 Email Templates
**New files in** `apps/webapp/src/lib/email/templates/`:
- `notification-approval-request.tsx` - Approval request email
- `notification-approval-result.tsx` - Approval/rejection result email
- `notification-security-alert.tsx` - Security event email

### 7.2 Email Service Integration
**Modify:** `apps/webapp/src/lib/notifications/notification-service.ts`
- Send email based on user preferences
- Use Resend API (already configured)

---

## Critical Files Summary

| Action | File Path |
|--------|-----------|
| **Modify** | `apps/webapp/src/db/schema.ts` |
| **Modify** | `apps/webapp/src/lib/query/keys.ts` |
| **Modify** | `apps/webapp/src/components/site-header.tsx` |
| **Modify** | `apps/webapp/src/app/[locale]/(app)/approvals/actions.ts` |
| **Modify** | `apps/webapp/src/components/settings/settings-nav.tsx` |
| **Create** | `apps/webapp/src/lib/notifications/` (service, types, triggers, push) |
| **Create** | `apps/webapp/src/components/notifications/` (all UI components) |
| **Create** | `apps/webapp/src/hooks/use-notifications.ts` |
| **Create** | `apps/webapp/src/hooks/use-notification-stream.ts` |
| **Create** | `apps/webapp/src/hooks/use-push-notifications.ts` |
| **Create** | `apps/webapp/src/app/api/notifications/` (all routes) |
| **Create** | `apps/webapp/src/app/[locale]/(app)/settings/notifications/page.tsx` |
| **Create** | `apps/webapp/public/sw.js` |

---

## Dependencies to Add

```bash
bun add web-push  # For sending push notifications server-side
```

---

## Verification Plan

### Manual Testing
1. **In-app notifications:**
   - Bell icon shows in header with unread count badge
   - Click bell opens popover with notification list
   - Click notification navigates to action URL and marks as read
   - "Mark all read" clears all unread

2. **Real-time updates:**
   - Submit an absence request in another tab
   - Notification appears in real-time without refresh

3. **Push notifications:**
   - Enable push in settings
   - Receive browser notification when approval changes
   - Click notification opens app to relevant page

4. **Email notifications:**
   - Receive email when absence request submitted/approved
   - Email contains correct details and action link

5. **Preferences:**
   - Disable email for a notification type
   - Verify no email sent for that type
   - Re-enable and verify email works again

### Automated Tests
- Unit tests for notification service functions
- API route tests for CRUD operations
- Integration tests for notification triggers in approval workflow

---

## Implementation Order

1. **Database & Types** - Schema, migration, types
2. **Core Service** - Notification CRUD service
3. **API Routes** - Basic REST endpoints
4. **Query Keys & Hooks** - React Query integration
5. **UI Components** - Bell, popover, list, item
6. **Header Integration** - Add bell to site header
7. **SSE Stream** - Real-time updates
8. **Triggers** - Hook into existing workflows
9. **Push Setup** - Service worker, VAPID, subscription
10. **Preferences** - Settings page and API
11. **Email Enhancement** - New templates and integration
