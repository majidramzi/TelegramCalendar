export type AnnouncementRsvpStatus = "going" | "maybe" | "not_going";

export interface AnnouncementEvent {
  title: string;
  description?: string | null;
  startsAt: Date | string;
  endsAt?: Date | string | null;
  allDay?: boolean;
  location?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  rsvpPublic?: boolean;
  emoji?: string | null;
  rsvpLocked?: boolean;
}

export interface AnnouncementVoter {
  status: AnnouncementRsvpStatus;
  displayName: string;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Legacy Markdown escape (kept for bot list helpers). */
export function escapeMd(text: string): string {
  return text.replace(/([_*`\[])/g, "\\$1");
}

export function formatWhen(
  value: Date | string,
  timezone: string,
  allDay = false,
): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-GB", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: allDay ? undefined : "short",
  });
}

export function buildMapsOpenUrl(
  lat: number,
  lng: number,
  label?: string | null,
): string {
  const name = encodeURIComponent((label || "Event location").trim());
  return `https://www.google.com/maps/search/?api=1&query=${lat}%2C${lng}&query=${name}`;
}

export function buildGeoUri(
  lat: number,
  lng: number,
  label?: string | null,
): string {
  const name = encodeURIComponent((label || "Event location").trim());
  return `geo:${lat},${lng}?q=${lat},${lng}(${name})`;
}

const RSVP_SECTIONS: {
  status: AnnouncementRsvpStatus;
  title: string;
}[] = [
  { status: "going", title: "✅ Going" },
  { status: "maybe", title: "🤔 Maybe" },
  { status: "not_going", title: "❌ No" },
];

function formatPublicVoters(
  voters: AnnouncementVoter[],
  maxPerStatus = 25,
): string[] {
  const lines: string[] = ["", "<b>👥 RSVPs</b>"];
  for (const section of RSVP_SECTIONS) {
    const names = voters
      .filter((v) => v.status === section.status)
      .map((v) => v.displayName.trim())
      .filter(Boolean);
    lines.push("", `<b>${section.title} (${names.length})</b>`);
    if (names.length === 0) {
      lines.push("<i>Nobody yet</i>");
      continue;
    }
    const shown = names.slice(0, maxPerStatus);
    for (const name of shown) {
      lines.push(`• ${escapeHtml(name)}`);
    }
    if (names.length > shown.length) {
      lines.push(`<i>…and ${names.length - shown.length} more</i>`);
    }
  }
  return lines;
}

function locationBlock(event: AnnouncementEvent): string[] {
  const label = (event.location || "Open map").trim();
  if (
    event.locationLat != null &&
    event.locationLng != null &&
    Number.isFinite(event.locationLat) &&
    Number.isFinite(event.locationLng)
  ) {
    const href = buildMapsOpenUrl(
      event.locationLat,
      event.locationLng,
      event.location,
    );
    return [
      "",
      "<b>📍 Location</b>",
      `<a href="${href}">${escapeHtml(label)}</a>`,
    ];
  }
  if (event.location) {
    return ["", "<b>📍 Location</b>", escapeHtml(event.location)];
  }
  return [];
}

/** Build the group announcement body (HTML parse mode). */
export function formatAnnouncement(
  event: AnnouncementEvent,
  timezone = "UTC",
  options?: {
    voters?: AnnouncementVoter[];
  },
): string {
  const icon = (event.emoji || "📢").trim() || "📢";
  const lines = [
    `${icon} <b>New event</b>`,
    "",
    `<b>${escapeHtml(event.title)}</b>`,
    "",
    `<b>🗓 Starts</b>`,
    escapeHtml(formatWhen(event.startsAt, timezone, event.allDay)),
  ];

  if (event.endsAt) {
    lines.push(
      "",
      "<b>🏁 Ends</b>",
      escapeHtml(formatWhen(event.endsAt, timezone, event.allDay)),
    );
  }

  lines.push(...locationBlock(event));

  if (event.description?.trim()) {
    lines.push("", "<b>📝 Details</b>", escapeHtml(event.description.trim()));
  }

  if (event.rsvpLocked) {
    lines.push("", "<i>First RSVP is final — votes cannot be changed.</i>");
  }

  if (event.rsvpPublic && options?.voters) {
    lines.push(...formatPublicVoters(options.voters));
  } else if (event.rsvpPublic === false) {
    lines.push("", "<i>RSVP names are private — only counts are shown.</i>");
  }

  let text = lines.join("\n");
  if (text.length > 4000) {
    text = `${text.slice(0, 3990)}\n<i>…</i>`;
  }
  return text;
}

/** Extract lat/lng from "lat, lng" text or common Google/Apple Maps URLs. */
export function parseLocationCoords(
  input: string | null | undefined,
): { lat: number; lng: number } | null {
  if (!input?.trim()) return null;
  const text = input.trim();

  const plain = text.match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/,
  );
  if (plain) {
    const lat = Number(plain[1]);
    const lng = Number(plain[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  const at = text.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) {
    const lat = Number(at[1]);
    const lng = Number(at[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  const q = text.match(/[?&](?:q|ll|query)=(-?\d+\.\d+)[,+](-?\d+\.\d+)/i);
  if (q) {
    const lat = Number(q[1]);
    const lng = Number(q[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  const destination = text.match(
    /destination=(-?\d+\.\d+)%2C(-?\d+\.\d+)/i,
  );
  if (destination) {
    const lat = Number(destination[1]);
    const lng = Number(destination[2]);
    if (isValidCoord(lat, lng)) return { lat, lng };
  }

  return null;
}

function isValidCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** Common event icons the organizer can pick. */
export const EVENT_EMOJI_CHOICES = [
  "📢",
  "📅",
  "🎉",
  "🎂",
  "🍕",
  "☕",
  "🏋️",
  "🎮",
  "🎬",
  "🎵",
  "✈️",
  "🏖️",
  "💼",
  "📚",
  "❤️",
  "⚽",
] as const;
