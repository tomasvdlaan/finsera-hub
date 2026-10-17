import { z } from 'zod';

/**
 * Notifications — the shapes both ends agree on. See docs/notifications-brief.md.
 */

/** What may interrupt: `now` pushes, `today` waits for the morning brief, `quiet` stays in-app. */
export const NOTIFICATION_TIERS = ['now', 'today', 'quiet'] as const;
export type NotificationTier = (typeof NOTIFICATION_TIERS)[number];

/**
 * The categories a person sees in settings, each one switchable for push.
 *
 * Coarser than the moments in the brief's catalogue on purpose: eight switches somebody can
 * reason about beat twenty-four they will not read.
 */
export const NOTIFICATION_CATEGORIES = [
  { key: 'mention', label: 'Mentions', description: 'Somebody names you in a comment.' },
  { key: 'task', label: 'Your tasks', description: 'Assigned to you, blocked on you, overdue.' },
  { key: 'comment', label: 'Comments', description: 'Replies and comments on things you work on.' },
  { key: 'client', label: 'Clients', description: 'Tickets, replies, and quotes accepted or declined.' },
  { key: 'time', label: 'Time', description: 'A clock running long, timesheets returned or waiting.' },
  { key: 'money', label: 'Money', description: 'Invoices paid or overdue, budgets, contracts.' },
  { key: 'meeting', label: 'Meetings', description: 'Notes finalised, action points waiting on you.' },
  { key: 'project', label: 'Projects', description: 'Added to a project, sprints starting and ending.' },
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]['key'];

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');

export const notificationSettingsSchema = z.object({
  /** IANA zone the working hours are in. */
  timeZone: z.string().min(1).default('Europe/Amsterdam'),
  /** ISO weekdays, Monday = 1. */
  workDays: z.array(z.number().int().min(1).max(7)).default([1, 2, 3, 4, 5]),
  workStart: clock.default('08:30'),
  workEnd: clock.default('18:30'),
  /** One push at the start of the working day with what is waiting. */
  brief: z.object({ enabled: z.boolean().default(true) }).default({}),
  /** Push per category; in-app is the record and cannot be turned off. */
  push: z.record(z.string(), z.boolean()).default({}),
  /** Reminders about a running clock. */
  timer: z
    .object({
      enabled: z.boolean().default(true),
      /** Hours of running before the first reminder; 0 turns that one off. */
      afterHours: z.number().min(0).max(24).default(3),
      endOfDay: z.boolean().default(true),
      overnight: z.boolean().default(true),
    })
    .default({}),
  /** Records whose comment notifications this person has muted. */
  muted: z.array(z.string().uuid()).default([]),
});
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

/** Push defaults: on for the categories that are about you by name or about time. */
export const DEFAULT_PUSH: Record<NotificationCategory, boolean> = {
  mention: true,
  task: true,
  comment: false,
  client: true,
  time: true,
  money: false,
  meeting: false,
  project: false,
};

/** One entry in the Inbox's *For you* — a group of occurrences about one thing. */
export interface NotificationView {
  id: string;
  category: string;
  tier: NotificationTier;
  title: string;
  /** Where opening it goes; null when the subject is gone or there is none. */
  url: string | null;
  subjectId: string | null;
  actorName: string | null;
  /** Unread occurrences collapsed into this entry (at least 1 while unread). */
  count: number;
  read: boolean;
  createdAt: string;
  /**
   * For a mention, the start of the comment — shown in the app, which is behind a sign-in.
   * Never part of `title`, which is what may reach a lock screen.
   */
  excerpt?: string;
}
