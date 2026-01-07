# Administrator Guide - Team Management System

This guide provides comprehensive instructions for administrators managing the Team Management System.

---

## Table of Contents

1. [Administrator Overview](#administrator-overview)
2. [Employee Management](#employee-management)
3. [Manager Assignments](#manager-assignments)
4. [Team Management](#team-management)
5. [Permission Management](#permission-management)
6. [Work Schedules](#work-schedules)
7. [Vacation Policies](#vacation-policies)
8. [Organization Settings](#organization-settings)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Administrator Overview

### Admin Responsibilities

As an administrator, you have full control over:
- ✅ Employee profiles and assignments
- ✅ Manager relationships
- ✅ Team structure and membership
- ✅ Permission grants for non-admin users
- ✅ Work schedules
- ✅ Vacation policies and allowances
- ✅ Organization-wide settings

### Admin Privileges

Administrators can:
- Create, edit, and deactivate employees
- Assign multiple managers to employees
- Create and manage teams
- Grant granular permissions to employees
- Override vacation allowances
- View all employee information
- Access system audit logs

---

## Employee Management

### Adding a New Employee

To add a new employee to the organization:

1. Go to **Settings** → **Employees**
2. Click **"Add Employee"** button
3. Fill in the employee information:
   - **User Account**: Select existing user or invite new user
   - **First Name**: Employee's given name
   - **Last Name**: Employee's family name
   - **Gender**: Optional (Male, Female, Other)
   - **Birthday**: Optional, for birthday tracking
   - **Position**: Job title or role
   - **Team**: Assign to a team (optional)
   - **Role**: System role (Admin, Manager, Employee)
   - **Start Date**: Employment start date
4. Click **"Create Employee"**

**Important Notes:**
- User accounts are separate from employee profiles
- One user can only belong to one organization
- Initial manager assignment can be done after creation
- New employees are active by default

### Editing Employee Information

To update an employee's profile:

1. Go to **Settings** → **Employees**
2. Find the employee (use search if needed)
3. Click on their name or **"View Details"**
4. Edit the information:
   - Personal information (name, gender, birthday)
   - Job information (position, team, role)
   - Status (active/inactive)
5. Click **"Save Changes"**

### Deactivating Employees

When an employee leaves:

1. Navigate to the employee's profile
2. Change status to **"Inactive"**
3. Click **"Save"**

**What happens when deactivated:**
- Employee loses system access
- Cannot submit new requests
- Historical data remains intact
- Can be reactivated later if needed

**Best Practice**: Keep employee records for at least one full year after departure for reporting and compliance purposes.

---

## Manager Assignments

### Understanding Multiple Managers

The system supports assigning multiple managers to each employee with these features:
- **Primary Manager**: One manager designated as the main point of contact
- **Secondary Managers**: Additional managers with equal approval authority
- **Approval Rights**: Any assigned manager can approve requests
- **Notifications**: All managers receive notifications about their managed employees

### Assigning Managers

To assign managers to an employee:

1. Go to **Settings** → **Employees** → (Select Employee)
2. Scroll to **"Manager Assignment"** section or click **"Assign Managers"**
3. **Select managers**:
   - Check the boxes next to each manager you want to assign
   - You can select multiple managers
4. **Designate primary manager**:
   - Select one manager as "Primary" using the radio buttons
   - This is required if assigning managers
5. Click **"Save Managers"**

**Important Rules:**
- ✅ At least one manager required for most employees
- ✅ Exactly one manager must be marked as primary
- ❌ Cannot assign an employee as their own manager
- ❌ Cannot create circular manager relationships (A manages B, B manages A)

### Removing Managers

To remove a manager from an employee:

1. Go to the employee's profile
2. Open **"Manager Assignment"**
3. Uncheck the manager you want to remove
4. Ensure at least one manager remains
5. If removing the primary manager, designate a new primary
6. Click **"Save Managers"**

**Notifications:**
- Employee receives email notification
- Removed manager receives notification
- Remaining managers are informed of changes

### Manager Best Practices

✅ **Assign primary managers thoughtfully** - They're the default contact
✅ **Use multiple managers for matrix organizations** - Support complex reporting structures
✅ **Keep manager assignments current** - Update when people change roles
✅ **Document manager responsibilities** - Clear expectations prevent confusion
✅ **Review manager assignments quarterly** - Ensure accuracy over time

---

## Team Management

### Creating Teams

To create a new team:

1. Go to **Settings** → **Teams**
2. Click **"Create Team"**
3. Enter team information:
   - **Name**: Team identifier (e.g., "Engineering", "Sales")
   - **Description**: Purpose and focus of the team (optional)
4. Click **"Create"**

### Managing Team Members

To add members to a team:

1. Go to **Settings** → **Teams** → (Select Team)
2. Click **"Add Member"**
3. Select employee from dropdown
4. Click **"Add"**

To remove members:
1. Find the member in the team's member list
2. Click the remove icon (🗑️) next to their name
3. Confirm removal

**Note**: Removing someone from a team doesn't deactivate their employee profile.

### Editing Teams

To modify team information:

1. Navigate to the team's detail page
2. Click **"Edit"** button
3. Update name and description
4. Click **"Save"**

### Deleting Teams

To delete a team:

1. Go to the team's detail page
2. Click **"Delete Team"** button
3. **Confirm deletion** - this cannot be undone!

**What happens:**
- Team is permanently removed
- Members are NOT deleted (they just lose team membership)
- Team-specific permissions may need reassignment

**Caution**: Only delete teams that are no longer needed. Consider keeping historical teams for reporting purposes.

---

## Permission Management

### Permission Types

The system has four granular team permissions:

1. **Can Create Teams**
   - Allows creating new teams in the organization
   - Typically granted to department heads or senior managers

2. **Can Manage Team Members**
   - Add and remove members from teams
   - Useful for team leads who manage their own teams

3. **Can Manage Team Settings**
   - Edit team name, description, and configuration
   - For team administrators who maintain team information

4. **Can Approve Team Requests**
   - Approve time-off and time corrections for team members
   - Commonly granted to managers and team leads

### Permission Scopes

Permissions can be granted at two levels:

- **Organization-Wide**: Permission applies to all teams
  - Use for: Senior managers, HR administrators
  - Example: Department head can manage all teams in their division

- **Team-Specific**: Permission applies to one specific team only
  - Use for: Team leads, project managers
  - Example: Team lead can only manage their own team

**Important**: Organization-wide permissions override team-specific ones.

### Granting Permissions

To grant permissions to an employee:

1. Go to **Settings** → **Permissions**
2. Find the employee in the list
3. Click **"Edit"** next to their name
4. **Select permission scope**:
   - Choose "All Teams (Organization-wide)" OR
   - Select a specific team from the dropdown
5. **Check permissions** to grant:
   - Can Create Teams
   - Can Manage Team Members
   - Can Manage Team Settings
   - Can Approve Team Requests
6. Click **"Save Permissions"**

**Note**: At least one permission must be selected to save.

### Revoking Permissions

To remove all permissions from an employee:

1. Go to **Settings** → **Permissions**
2. Find the employee
3. Click **"Edit"**
4. Click **"Revoke All"** button
5. Confirm revocation

### Permission Best Practices

✅ **Grant minimum necessary permissions** - Principle of least privilege
✅ **Use team-specific permissions when possible** - Better security and clarity
✅ **Review permissions quarterly** - Ensure they match current roles
✅ **Document permission policies** - Clear guidelines for granting access
✅ **Audit permission usage** - Check logs for unusual activity

### Admin vs Regular Permissions

**Admins** automatically have all permissions and cannot be restricted:
- Full access to all features
- Can grant/revoke permissions
- Can override any setting
- System-level privileges

**Non-admin employees** must be explicitly granted permissions:
- Start with no team permissions
- Permissions must be granted by admins
- Can be restricted to specific teams
- Permissions can be revoked at any time

---

## Work Schedules

### Schedule Types

The system supports two schedule types:

#### Simple Schedule
- **Description**: Total weekly hours as one number
- **Example**: 40 hours per week
- **Best for**: Standard full-time, part-time schedules
- **Configuration**: Single input field

#### Detailed Schedule
- **Description**: Hours specified for each day of the week
- **Example**: Mon-Fri 8 hours each, weekends off
- **Best for**: Irregular schedules, shift work, compressed weeks
- **Configuration**: 7 input fields with work day checkboxes

### Work Classifications

Schedules can be classified as:
- **Daily**: Hours tracked per day
- **Weekly**: Hours tracked per week (most common)
- **Monthly**: Hours tracked per month

Classification affects how time is reported and tracked but doesn't change the actual schedule.

### Creating Work Schedules

To set up an employee's work schedule:

1. Go to **Settings** → **Employees** → (Select Employee)
2. Scroll to **"Work Schedule"** section
3. Click **"Configure Schedule"**
4. **Choose schedule type**:
   - Tab: "Simple Schedule" or "Detailed Schedule"
5. **Enter schedule information**:

   **For Simple:**
   - Hours per week (0-168)
   - Work classification
   - Effective from date

   **For Detailed:**
   - Check work days
   - Enter hours for each work day (0-24)
   - Leave non-work days unchecked
   - Work classification
   - Effective from date

6. **Review total hours** displayed at bottom
7. Click **"Save Schedule"**

### Schedule History

The system maintains a complete history of schedule changes:
- **Effective dates**: Each schedule has a start date
- **Previous schedules**: Automatically archived when new schedule created
- **Reporting**: Historical schedules used for accurate time calculations

To view schedule history:
1. Go to employee profile
2. Click "View Schedule History"
3. See all past schedules with effective dates

### Schedule Best Practices

✅ **Set schedules promptly** - Affects vacation calculations immediately
✅ **Use effective dates correctly** - Schedule changes apply from that date forward
✅ **Match actual work patterns** - Accurate schedules improve reporting
✅ **Update for role changes** - Adjust when employees move to different positions
✅ **Communicate changes** - Inform employees when schedules are modified

---

## Vacation Policies

### Organization Default Policy

To set the organization-wide vacation policy:

1. Go to **Settings** → **Vacation** → **"Policy"**
2. Configure default settings:
   - **Default Annual Days**: Base vacation days per year (e.g., 20)
   - **Carryover Policy**: Allow/disallow carryover
   - **Max Carryover Days**: If allowed, maximum days that can carry over
   - **Accrual Method**: Front-loaded, accrual, or custom
3. Click **"Save Policy"**

**This policy applies to all employees by default** unless overridden individually.

### Employee-Specific Allowances

To customize vacation allowance for an individual employee:

1. Go to **Settings** → **Vacation** → **"Employees"**
2. Find the employee
3. Click **"Edit"** next to their name
4. Configure custom allowance:
   - **Custom Annual Days**: Override org default (leave blank to use default)
   - **Carryover Days**: Days brought forward from previous year
   - **Adjustment Days**: Add or subtract days (can be positive or negative)
   - **Adjustment Reason**: Required explanation for adjustments
5. **Review total allowance** displayed at top
6. Click **"Save Changes"**

### Allowance Calculations

Total allowance is calculated as:
```
Total = Annual Days + Carryover + Adjustments
```

**Example:**
- Annual Days: 20 (org default)
- Carryover: 5 (from last year)
- Adjustments: +2 (bonus days)
- **Total Available: 27 days**

### Common Vacation Scenarios

**New Employee Mid-Year:**
1. Create employee profile
2. Set appropriate annual days (may be prorated)
3. Note: Some organizations prorate first-year vacation

**Long-Service Bonus:**
1. Go to employee's vacation allowance
2. Add adjustment days (e.g., +5)
3. Enter reason: "10-year service bonus"
4. Save changes

**Correction (Employee Miscounting):**
1. Review actual usage
2. Add/subtract correction via adjustments
3. Document reason clearly
4. Communicate with employee

---

## Organization Settings

### User Invitations

To invite new users to the organization:

1. Go to **Settings** → **Members** → **"Invite"**
2. Enter user information:
   - **Email**: User's email address
   - **Role**: Initial role (Member, Admin)
   - **Can Create Organizations**: Special permission (usually NO for invited users)
3. Click **"Send Invitation"**

**Important Permission Notes:**
- **Fresh signups** (not invited): CAN create new organizations
- **Invited users**: CANNOT create new organizations by default
- **Admins**: Can always create organizations regardless of invitation status

This prevents invited users from creating competing organizations while allowing organic growth through direct signups.

### Managing Invitations

View pending invitations:
1. Go to **Settings** → **Members** → **"Invitations"**
2. See list of pending invitations
3. Options:
   - **Resend**: Send invitation email again
   - **Cancel**: Revoke invitation before acceptance

### Organization Profile

To update organization information:

1. Go to **Settings** → **Organization**
2. Update:
   - Organization name
   - Logo
   - Contact information
   - Time zone
3. Click **"Save"**

---

## Best Practices

### Security & Access Control

✅ **Regular permission audits** - Review who has what access quarterly
✅ **Principle of least privilege** - Only grant necessary permissions
✅ **Remove access promptly** - Deactivate employees on their last day
✅ **Document admin actions** - Keep notes on major changes
✅ **Use team-specific permissions** - More secure than org-wide for most roles

### Data Management

✅ **Keep employee records accurate** - Regular data hygiene
✅ **Maintain manager assignments** - Update when org structure changes
✅ **Archive old teams properly** - Don't delete historical data unnecessarily
✅ **Review vacation policies annually** - Ensure they match company policy
✅ **Back up important configurations** - Document critical settings

### Communication

✅ **Notify employees of changes** - Transparency builds trust
✅ **Train new managers** - Ensure they understand their responsibilities
✅ **Document policies clearly** - Share written guidelines with all employees
✅ **Respond to questions promptly** - Be accessible to users
✅ **Announce new features** - Keep users informed of system updates

### Process Management

✅ **Standardize onboarding** - Consistent process for new employees
✅ **Plan team restructures** - Coordinate manager and team changes
✅ **Schedule regular reviews** - Quarterly check-in on system usage
✅ **Monitor approval times** - Ensure managers are responsive
✅ **Track system usage** - Identify unused features or problem areas

---

## Troubleshooting

### Common Issues

#### "Cannot assign manager - circular relationship detected"
**Problem**: Trying to create a loop (A manages B, B manages A)
**Solution**: Choose a different manager or restructure the management hierarchy

#### "Employee cannot create organization"
**Problem**: Invited user trying to create new organization
**Solution**: This is by design. Only fresh signups can create organizations. Grant admin status if they need this ability.

#### "Permission not taking effect"
**Problem**: User still can't access feature after granting permission
**Solution**:
1. Verify permission was saved (check Permissions page)
2. Ask user to log out and log back in
3. Check if permission scope is correct (org-wide vs team-specific)
4. Verify user is not an admin (admins have all permissions automatically)

#### "Work schedule total hours not calculating correctly"
**Problem**: Total hours don't match expected value
**Solution**:
1. For simple schedule: Verify hours per week value
2. For detailed schedule: Check all 7 days are configured
3. Ensure only work days (checked boxes) are counted
4. Verify no typos in hour values

#### "Vacation balance seems wrong"
**Problem**: Employee's available days don't match expectations
**Solution**:
1. Review vacation allowance page for that employee
2. Check: Annual days + Carryover + Adjustments = Total
3. Verify usage (approved absences) is subtracted correctly
4. Check if custom allowance overrides org default
5. Confirm work schedule (part-time may have prorated vacation)

### Getting Help

If you encounter issues not covered here:

1. **Check audit logs** - See what actions were taken
2. **Review documentation** - Re-read relevant sections
3. **Contact support** - Reach out to your system vendor
4. **Community forum** - Other admins may have solutions

**For Critical Issues:**
- Production-down situations
- Security concerns
- Data integrity problems

Contact emergency support immediately with:
- Description of the problem
- Impact on users
- Steps already taken
- Error messages or screenshots

---

## Appendix: Quick Reference

### Key Admin Actions

| Task | Navigation | Permission Required |
|------|-----------|-------------------|
| Add Employee | Settings → Employees → Add | Admin |
| Assign Manager | Settings → Employees → [Employee] → Managers | Admin |
| Create Team | Settings → Teams → Create | Admin or Can Create Teams |
| Grant Permission | Settings → Permissions → [Employee] → Edit | Admin |
| Set Schedule | Settings → Employees → [Employee] → Schedule | Admin |
| Modify Vacation | Settings → Vacation → Employees → [Employee] | Admin |
| Send Invitation | Settings → Members → Invite | Admin |

### Keyboard Shortcuts

- **Ctrl/Cmd + K**: Global search
- **Ctrl/Cmd + S**: Save changes (when editing)
- **Esc**: Close modal/dialog
- **Tab**: Navigate form fields
- **Enter**: Submit form (when focused on button)

### Support Resources

- **User Guide**: For end-user instructions
- **API Documentation**: For integrations (separate document)
- **Release Notes**: New features and changes
- **Status Page**: System availability and incidents

---

**Version**: 1.0
**Last Updated**: January 2026
**For**: System Administrators

*This guide is regularly updated with new features and best practices. Check for updates monthly.*
