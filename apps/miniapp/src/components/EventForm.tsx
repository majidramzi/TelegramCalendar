import { useState } from "react";
import { EVENT_EMOJI_CHOICES } from "@tg-cal/shared/announce";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { LocationPicker } from "./LocationPicker";

export interface EventFormValues {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
  locationLat: number | null;
  locationLng: number | null;
  emoji: string;
  rsvpPublic: boolean;
  rsvpLocked: boolean;
  timezone: string;
}

interface Props {
  locale: Locale;
  initial?: Partial<EventFormValues>;
  submitting?: boolean;
  onSubmit: (values: EventFormValues) => void;
  onCancel: () => void;
}

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function EventForm({
  locale,
  initial,
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? toLocalInput(initial.startsAt) : "",
  );
  const [endsAt, setEndsAt] = useState(
    initial?.endsAt ? toLocalInput(initial.endsAt) : "",
  );
  const [allDay, setAllDay] = useState(initial?.allDay ?? false);
  const [location, setLocation] = useState(initial?.location ?? "");
  const [locationLat, setLocationLat] = useState<number | null>(
    initial?.locationLat ?? null,
  );
  const [locationLng, setLocationLng] = useState<number | null>(
    initial?.locationLng ?? null,
  );
  const [emoji, setEmoji] = useState(initial?.emoji ?? "📢");
  const [rsvpPublic, setRsvpPublic] = useState(initial?.rsvpPublic ?? true);
  const [rsvpLocked, setRsvpLocked] = useState(initial?.rsvpLocked ?? false);

  const picked =
    locationLat != null && locationLng != null
      ? {
          name: location || `${locationLat}, ${locationLng}`,
          lat: locationLat,
          lng: locationLng,
        }
      : null;

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          title,
          description,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endsAt ? new Date(endsAt).toISOString() : "",
          allDay,
          location,
          locationLat,
          locationLng,
          emoji,
          rsvpPublic,
          rsvpLocked,
          timezone: browserTimezone(),
        });
      }}
    >
      <label>
        {t(locale, "emoji")}
        <div className="emoji-grid" role="listbox" aria-label={t(locale, "emoji")}>
          {EVENT_EMOJI_CHOICES.map((item) => (
            <button
              key={item}
              type="button"
              className={`emoji-btn${emoji === item ? " active" : ""}`}
              onClick={() => setEmoji(item)}
              aria-pressed={emoji === item}
            >
              {item}
            </button>
          ))}
        </div>
      </label>

      <label>
        {t(locale, "title")}
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        {t(locale, "startsAt")}
        <input
          required
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </label>
      <label>
        {t(locale, "endsAt")}
        <input
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
        />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />
        {t(locale, "allDay")}
      </label>

      <fieldset className="fieldset">
        <legend>{t(locale, "location")}</legend>
        <label>
          {t(locale, "locationName")}
          <input
            value={location}
            placeholder={t(locale, "locationHint")}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <LocationPicker
          locale={locale}
          value={picked}
          onChange={(next) => {
            if (!next) {
              setLocationLat(null);
              setLocationLng(null);
              return;
            }
            setLocationLat(next.lat);
            setLocationLng(next.lng);
            setLocation((prev) => prev.trim() || next.name);
          }}
        />
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={rsvpPublic}
          onChange={(e) => setRsvpPublic(e.target.checked)}
        />
        {t(locale, "rsvpPublic")}
      </label>
      <p className="hint">
        {rsvpPublic ? t(locale, "rsvpPublicHint") : t(locale, "rsvpPrivateHint")}
      </p>

      <label className="check">
        <input
          type="checkbox"
          checked={rsvpLocked}
          onChange={(e) => setRsvpLocked(e.target.checked)}
        />
        {t(locale, "rsvpLocked")}
      </label>
      <p className="hint">
        {rsvpLocked ? t(locale, "rsvpLockedHint") : t(locale, "rsvpUnlockedHint")}
      </p>

      <label>
        {t(locale, "description")}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <div className="actions">
        <button type="submit" className="btn" disabled={submitting}>
          {t(locale, "save")}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          {t(locale, "cancel")}
        </button>
      </div>
    </form>
  );
}
