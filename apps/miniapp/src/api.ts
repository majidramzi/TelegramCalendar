import type { EventDto, RsvpStatus } from "@tg-cal/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

function getInitData(): string {
  return window.Telegram?.WebApp?.initData ?? "";
}

function getStartParam(): string {
  return (
    window.Telegram?.WebApp?.initDataUnsafe?.start_param ??
    new URLSearchParams(window.location.search).get("tgWebAppStartParam") ??
    ""
  );
}

export function getStartAppToken(): string {
  return getStartParam();
}

async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const startapp = getStartAppToken();
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-Telegram-Init-Data", getInitData());
  if (startapp) headers.set("X-Startapp", startapp);

  const url = new URL(`${API_URL}${path}`);
  if (startapp && !url.searchParams.has("startapp")) {
    url.searchParams.set("startapp", startapp);
  }

  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface ChatInfo {
  id: string;
  title: string;
  type: string;
  timezone: string;
  permissionMode: string;
}

export function fetchChat() {
  const timezone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  })();
  const q = timezone ? `?timezone=${encodeURIComponent(timezone)}` : "";
  return api<{ id: string; title: string; type: string; timezone: string; permissionMode: string }>(
    `/api/chat${q}`,
  );
}

export function fetchEvents(params?: { from?: string; to?: string; upcoming?: boolean }) {
  const q = new URLSearchParams();
  if (params?.from) q.set("from", params.from);
  if (params?.to) q.set("to", params.to);
  if (params?.upcoming) q.set("upcoming", "1");
  const qs = q.toString();
  return api<{ events: EventDto[] }>(`/api/events${qs ? `?${qs}` : ""}`);
}

export function fetchEvent(id: string) {
  return api<{ event: EventDto }>(`/api/events/${id}`);
}

export function createEvent(body: {
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  emoji?: string;
  rsvpPublic?: boolean;
  rsvpLocked?: boolean;
  timezone?: string;
}) {
  return api<{ event: EventDto }>("/api/events", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateEvent(
  id: string,
  body: Partial<{
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
    location: string | null;
    locationLat: number | null;
    locationLng: number | null;
    emoji: string;
    rsvpPublic: boolean;
    rsvpLocked: boolean;
    timezone: string;
  }>,
) {
  return api<{ event: EventDto }>(`/api/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function deleteEvent(id: string) {
  return api<{ ok: boolean }>(`/api/events/${id}`, { method: "DELETE" });
}

export function setRsvp(id: string, status: RsvpStatus) {
  return api<{ event: EventDto }>(`/api/events/${id}/rsvp`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export function fetchIcsUrl() {
  return api<{ url: string }>("/ics-url");
}
