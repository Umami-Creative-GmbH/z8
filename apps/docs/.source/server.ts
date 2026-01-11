// @ts-nocheck
import { default as __fd_glob_36 } from "../content/docs/user-guide/meta.json?collection=meta"
import { default as __fd_glob_35 } from "../content/docs/technical/meta.json?collection=meta"
import { default as __fd_glob_34 } from "../content/docs/manager-guide/meta.json?collection=meta"
import { default as __fd_glob_33 } from "../content/docs/getting-started/meta.json?collection=meta"
import { default as __fd_glob_32 } from "../content/docs/deployment/meta.json?collection=meta"
import { default as __fd_glob_31 } from "../content/docs/admin-guide/meta.json?collection=meta"
import { default as __fd_glob_30 } from "../content/docs/meta.json?collection=meta"
import * as __fd_glob_29 from "../content/docs/user-guide/vacation.mdx?collection=docs"
import * as __fd_glob_28 from "../content/docs/user-guide/time-tracking.mdx?collection=docs"
import * as __fd_glob_27 from "../content/docs/user-guide/notifications.mdx?collection=docs"
import * as __fd_glob_26 from "../content/docs/user-guide/index.mdx?collection=docs"
import * as __fd_glob_25 from "../content/docs/user-guide/getting-started.mdx?collection=docs"
import * as __fd_glob_24 from "../content/docs/user-guide/faq.mdx?collection=docs"
import * as __fd_glob_23 from "../content/docs/user-guide/calendar.mdx?collection=docs"
import * as __fd_glob_22 from "../content/docs/manager-guide/index.mdx?collection=docs"
import * as __fd_glob_21 from "../content/docs/technical/testing.mdx?collection=docs"
import * as __fd_glob_20 from "../content/docs/technical/services.mdx?collection=docs"
import * as __fd_glob_19 from "../content/docs/technical/index.mdx?collection=docs"
import * as __fd_glob_18 from "../content/docs/technical/getting-started.mdx?collection=docs"
import * as __fd_glob_17 from "../content/docs/technical/features.mdx?collection=docs"
import * as __fd_glob_16 from "../content/docs/technical/database.mdx?collection=docs"
import * as __fd_glob_15 from "../content/docs/technical/authentication.mdx?collection=docs"
import * as __fd_glob_14 from "../content/docs/deployment/index.mdx?collection=docs"
import * as __fd_glob_13 from "../content/docs/getting-started/index.mdx?collection=docs"
import * as __fd_glob_12 from "../content/docs/admin-guide/troubleshooting.mdx?collection=docs"
import * as __fd_glob_11 from "../content/docs/admin-guide/time-regulations.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/admin-guide/teams.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/admin-guide/system-administration.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/admin-guide/schedules.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/admin-guide/permissions.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/admin-guide/manager-assignments.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/admin-guide/locations.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/admin-guide/index.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/admin-guide/holidays-and-vacation.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/admin-guide/employee-management.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/admin-guide/analytics-and-exports.mdx?collection=docs"
import * as __fd_glob_0 from "../content/docs/index.mdx?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.doc("docs", "content/docs", {"index.mdx": __fd_glob_0, "admin-guide/analytics-and-exports.mdx": __fd_glob_1, "admin-guide/employee-management.mdx": __fd_glob_2, "admin-guide/holidays-and-vacation.mdx": __fd_glob_3, "admin-guide/index.mdx": __fd_glob_4, "admin-guide/locations.mdx": __fd_glob_5, "admin-guide/manager-assignments.mdx": __fd_glob_6, "admin-guide/permissions.mdx": __fd_glob_7, "admin-guide/schedules.mdx": __fd_glob_8, "admin-guide/system-administration.mdx": __fd_glob_9, "admin-guide/teams.mdx": __fd_glob_10, "admin-guide/time-regulations.mdx": __fd_glob_11, "admin-guide/troubleshooting.mdx": __fd_glob_12, "getting-started/index.mdx": __fd_glob_13, "deployment/index.mdx": __fd_glob_14, "technical/authentication.mdx": __fd_glob_15, "technical/database.mdx": __fd_glob_16, "technical/features.mdx": __fd_glob_17, "technical/getting-started.mdx": __fd_glob_18, "technical/index.mdx": __fd_glob_19, "technical/services.mdx": __fd_glob_20, "technical/testing.mdx": __fd_glob_21, "manager-guide/index.mdx": __fd_glob_22, "user-guide/calendar.mdx": __fd_glob_23, "user-guide/faq.mdx": __fd_glob_24, "user-guide/getting-started.mdx": __fd_glob_25, "user-guide/index.mdx": __fd_glob_26, "user-guide/notifications.mdx": __fd_glob_27, "user-guide/time-tracking.mdx": __fd_glob_28, "user-guide/vacation.mdx": __fd_glob_29, });

export const meta = await create.meta("meta", "content/docs", {"meta.json": __fd_glob_30, "admin-guide/meta.json": __fd_glob_31, "deployment/meta.json": __fd_glob_32, "getting-started/meta.json": __fd_glob_33, "manager-guide/meta.json": __fd_glob_34, "technical/meta.json": __fd_glob_35, "user-guide/meta.json": __fd_glob_36, });