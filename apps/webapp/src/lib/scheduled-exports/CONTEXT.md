# Scheduled Exports

How an organization runs payroll exports, data exports and audit reports on a schedule and delivers each file to the people allowed to receive it.

## Language

**Scheduled export**:
A payroll export, data export or audit report that an organization has set to run on a schedule and deliver to its export recipients.
_Avoid_: automated export, recurring report, export job

**Run**:
One execution of a scheduled export, producing at most one file.
_Avoid_: execution, job

**Schedule owner**:
The org admin a scheduled export acts on behalf of. Automated runs are attributed to them, and the schedule pauses when they are no longer an org admin.
_Avoid_: creator, schedule creator

**Export recipient**:
Someone a scheduled export is delivered to: either an org admin or an approved external recipient.
_Avoid_: subscriber, addressee

**Approved external recipient**:
An email address, with a label, that an org admin has approved to receive scheduled exports. It needs no Z8 account and may also belong to a member who isn't an org admin.
_Avoid_: external recipient, allowlisted address, whitelist entry

**Download link**:
A secret, expiring URL emailed to an approved external recipient that lets them download one run's file without signing in.
_Avoid_: share link, presigned URL, export link

**Download code**:
A short-lived one-time code sent to an approved external recipient's address when they open a download link, proving they can read that mailbox before any download.
_Avoid_: OTP, PIN, verification code

**Download log**:
The record of every download, and every download code sent or checked, through a download link: which link, which recipient, when and from where.
_Avoid_: access log, view log, audit log
