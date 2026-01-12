import { docs, meta } from '@/.source/server';
import { toFumadocsSource } from 'fumadocs-mdx/runtime/server';
import { loader } from 'fumadocs-core/source';
import { createElement } from 'react';
import {
  IconRocket,
  IconUser,
  IconUsers,
  IconShieldLock,
  IconCode,
  IconServer,
  IconUserPlus,
  IconUserCog,
  IconUsersGroup,
  IconMapPin,
  IconLock,
  IconCalendarTime,
  IconScale,
  IconBeach,
  IconChartBar,
  IconSettings,
  IconBug,
  IconPlayerPlay,
  IconDatabase,
  IconKey,
  IconCloud,
  IconTestPipe,
  IconClock,
  IconCalendar,
  IconBell,
  IconUmbrella,
  IconHelp,
  IconBriefcase,
  IconPercentage,
  IconBook,
} from '@tabler/icons-react';

// Map icon names to Tabler icon components
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  // Main sections
  Rocket: IconRocket,
  User: IconUser,
  Users: IconUsers,
  ShieldLock: IconShieldLock,
  Code: IconCode,
  Server: IconServer,
  Book: IconBook,
  // Admin Guide
  UserPlus: IconUserPlus,
  UserCog: IconUserCog,
  UsersGroup: IconUsersGroup,
  MapPin: IconMapPin,
  Lock: IconLock,
  CalendarTime: IconCalendarTime,
  Scale: IconScale,
  Beach: IconBeach,
  ChartBar: IconChartBar,
  Settings: IconSettings,
  Bug: IconBug,
  Briefcase: IconBriefcase,
  Percent: IconPercentage,
  // Technical
  PlayerPlay: IconPlayerPlay,
  Database: IconDatabase,
  Key: IconKey,
  Cloud: IconCloud,
  TestPipe: IconTestPipe,
  // User Guide
  Clock: IconClock,
  Calendar: IconCalendar,
  Bell: IconBell,
  Umbrella: IconUmbrella,
  Help: IconHelp,
};

export const source = loader({
  baseUrl: '/docs',
  source: toFumadocsSource(docs, meta),
  icon(icon) {
    if (!icon) return;
    if (icon in iconMap) {
      return createElement(iconMap[icon], { className: 'size-4' });
    }
  },
});
