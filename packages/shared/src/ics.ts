export interface PersonalIcsEvent {
  id: string;
  title: string;
  description?: string | null;
  startsAt: Date | string;
  endsAt?: Date | string | null;
  allDay?: boolean;
  location?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  emoji?: string | null;
}

export type PersonalIcsStatus = "going" | "maybe" | "not_going";

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatIcsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `;VALUE=DATE:${y}${m}${day}`;
  }
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `:${iso}`;
}

function asDate(value: Date | string): Date {
  return typeof value === "string" ? new Date(value) : value;
}

/** Stable UID so re-imports update the same calendar entry. */
export function personalEventUid(eventId: string, userId: string | number | bigint): string {
  return `${eventId}-u${userId}@telegram-calendar`;
}

/**
 * Build a personal .ics for phone calendars.
 * going → CONFIRMED, maybe → TENTATIVE, not_going → METHOD:CANCEL
 */
export function buildPersonalIcs(options: {
  event: PersonalIcsEvent;
  userId: string | number | bigint;
  status: PersonalIcsStatus;
  sequence: number;
}): string {
  const { event, userId, status, sequence } = options;
  const startsAt = asDate(event.startsAt);
  const endsAt = event.endsAt ? asDate(event.endsAt) : null;
  const stamp = new Date();
  const method = status === "not_going" ? "CANCEL" : "PUBLISH";
  const partStat =
    status === "going" ? "ACCEPTED" : status === "maybe" ? "TENTATIVE" : "DECLINED";
  const eventStatus =
    status === "not_going"
      ? "CANCELLED"
      : status === "maybe"
        ? "TENTATIVE"
        : "CONFIRMED";

  const summary = `${event.emoji ? `${event.emoji} ` : ""}${event.title}`;
  const location =
    event.location ||
    (event.locationLat != null && event.locationLng != null
      ? `${event.locationLat}, ${event.locationLng}`
      : null);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//telegram-calendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${method}`,
    "BEGIN:VEVENT",
    `UID:${personalEventUid(event.id, userId)}`,
    `SEQUENCE:${Math.max(0, sequence)}`,
    `DTSTAMP${formatIcsDate(stamp, false)}`,
    `DTSTART${formatIcsDate(startsAt, !!event.allDay)}`,
  ];

  if (endsAt) {
    lines.push(`DTEND${formatIcsDate(endsAt, !!event.allDay)}`);
  } else if (event.allDay) {
    const end = new Date(startsAt);
    end.setUTCDate(end.getUTCDate() + 1);
    lines.push(`DTEND${formatIcsDate(end, true)}`);
  }

  lines.push(`SUMMARY:${icsEscape(summary)}`);
  lines.push(`STATUS:${eventStatus}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  }
  if (location) {
    lines.push(`LOCATION:${icsEscape(location)}`);
  }
  if (event.locationLat != null && event.locationLng != null) {
    lines.push(`GEO:${event.locationLat};${event.locationLng}`);
  }
  lines.push(
    "BEGIN:VALARM",
    "TRIGGER:-PT1H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsEscape(summary)}`,
    "END:VALARM",
  );
  lines.push(`COMMENT:RSVP ${partStat}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
