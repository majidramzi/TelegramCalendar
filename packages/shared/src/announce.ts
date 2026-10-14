import {
  normalizeRsvpOptions,
  type RsvpOption,
} from "./rsvpOptions.js";

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
  rsvpOptions?: unknown;
  rsvpCloseBeforeMinutes?: number;
}

export interface AnnouncementVoter {
  optionId: string;
  displayName: string;
  /** @deprecated legacy */
  status?: AnnouncementRsvpStatus;
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

function formatPublicVoters(
  options: RsvpOption[],
  voters: AnnouncementVoter[],
  maxPerStatus = 25,
): string[] {
  const lines: string[] = ["", "<b>👥 Attendance</b>"];
  const sorted = [...options].sort((a, b) => a.order - b.order);
  for (const opt of sorted) {
    const names = voters
      .filter((v) => v.optionId === opt.id)
      .map((v) => v.displayName.trim())
      .filter(Boolean);
    lines.push(
      "",
      `<b>${escapeHtml(opt.emoji)} ${escapeHtml(opt.label)} (${names.length})</b>`,
    );
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

/** Telegram photo caption limit (HTML). */
export const TELEGRAM_CAPTION_MAX = 1024;
/** Telegram text message limit (HTML). */
export const TELEGRAM_MESSAGE_MAX = 4096;

function fitAnnouncementLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const ellipsis = "\n<i>…</i>";
  const keep = Math.max(0, maxLength - ellipsis.length);
  return `${text.slice(0, keep)}${ellipsis}`;
}

/** Build the group announcement body (HTML parse mode). */
export function formatAnnouncement(
  event: AnnouncementEvent,
  timezone = "UTC",
  options?: {
    voters?: AnnouncementVoter[];
    /** Default 4096; use 1024 for photo captions. */
    maxLength?: number;
  },
): string {
  const maxLength = options?.maxLength ?? TELEGRAM_MESSAGE_MAX;
  const icon = (event.emoji || "📢").trim() || "📢";

  function build(includeVoters: boolean): string {
    const lines = [`${icon} <b>${escapeHtml(event.title)}</b>`];

    if (event.description?.trim()) {
      lines.push(escapeHtml(event.description.trim()));
    }

    lines.push(
      "",
      `<b>🗓 Starts</b>`,
      escapeHtml(formatWhen(event.startsAt, timezone, event.allDay)),
    );

    if (event.endsAt) {
      lines.push(
        "",
        "<b>🏁 Ends</b>",
        escapeHtml(formatWhen(event.endsAt, timezone, event.allDay)),
      );
    }

    lines.push(...locationBlock(event));

    if (event.rsvpLocked) {
    lines.push("", "<i>First vote is final — votes cannot be changed.</i>");
  }

  if (includeVoters && event.rsvpPublic && options?.voters) {
    const rsvpOpts = normalizeRsvpOptions(event.rsvpOptions);
    lines.push(...formatPublicVoters(rsvpOpts, options.voters));
  } else if (event.rsvpPublic === false) {
    lines.push(
      "",
      "<i>Voter names are private — only counts are shown.</i>",
    );
  }

    return lines.join("\n");
  }

  let text = build(true);
  if (text.length > maxLength && options?.voters?.length) {
    // Prefer dropping long voter lists over cutting mid-message.
    text = build(false);
  }
  return fitAnnouncementLength(text, maxLength);
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
