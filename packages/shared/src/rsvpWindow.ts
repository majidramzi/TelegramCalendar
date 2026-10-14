/** Minutes before event start when RSVP closes. 0 = until start. */
export const RSVP_CLOSE_BEFORE_CHOICES = [0, 720, 1440] as const;

export type RsvpCloseBeforeMinutes =
  (typeof RSVP_CLOSE_BEFORE_CHOICES)[number];

export function normalizeRsvpCloseBefore(
  raw: unknown,
): RsvpCloseBeforeMinutes {
  if (raw === 720 || raw === 1440) return raw;
  return 0;
}

/** Instant when RSVP voting closes (exclusive — vote must be before this). */
export function rsvpCloseAt(
  startsAt: Date | string,
  rsvpCloseBeforeMinutes: number,
): Date {
  const start =
    typeof startsAt === "string" ? new Date(startsAt) : new Date(startsAt);
  return new Date(
    start.getTime() - (rsvpCloseBeforeMinutes || 0) * 60_000,
  );
}

/** False after event start, or after the configured close-before deadline. */
export function isRsvpOpen(
  startsAt: Date | string,
  rsvpCloseBeforeMinutes: number,
  now: Date = new Date(),
): boolean {
  const start =
    typeof startsAt === "string" ? new Date(startsAt) : new Date(startsAt);
  if (Number.isNaN(start.getTime())) return false;
  if (now.getTime() >= start.getTime()) return false;
  return now.getTime() < rsvpCloseAt(start, rsvpCloseBeforeMinutes).getTime();
}
