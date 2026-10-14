import { useState } from "react";
import { EVENT_EMOJI_CHOICES } from "@tg-cal/shared/announce";
import {
  defaultRsvpOptions,
  type RsvpOption,
} from "@tg-cal/shared/rsvpOptions";
import {
  RSVP_CLOSE_BEFORE_CHOICES,
  normalizeRsvpCloseBefore,
  type RsvpCloseBeforeMinutes,
} from "@tg-cal/shared/rsvpWindow";
import type { Locale, MessageKey } from "../i18n";
import { t } from "../i18n";
import { compressEventPhoto } from "../image";
import { HelpTip } from "./HelpTip";
import { LocationPicker } from "./LocationPicker";
import { RsvpOptionsEditor } from "./RsvpOptionsEditor";

export const REMINDER_OPTIONS = [
  { minutes: 60, key: "remind1h" as const },
  { minutes: 120, key: "remind2h" as const },
  { minutes: 1440, key: "remind1d" as const },
  { minutes: 2880, key: "remind2d" as const },
  { minutes: 10080, key: "remind1w" as const },
];

const RSVP_DEADLINE_OPTIONS: {
  minutes: RsvpCloseBeforeMinutes;
  key: MessageKey;
}[] = [
  { minutes: 0, key: "rsvpUntilStart" },
  { minutes: 720, key: "rsvp12hBefore" },
  { minutes: 1440, key: "rsvp1dBefore" },
];

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
  rsvpOptions: RsvpOption[];
  rsvpCloseBeforeMinutes: RsvpCloseBeforeMinutes;
  remindBefore: number[];
  timezone: string;
  /** New photo to upload (base64 without data: prefix is fine). */
  photoBase64?: string;
  photoMime?: string;
  /** True when user removed an existing photo. */
  clearPhoto?: boolean;
}

interface Props {
  locale: Locale;
  initial?: Partial<EventFormValues> & {
    hasPhoto?: boolean;
    photoUrl?: string | null;
  };
  submitting?: boolean;
  onSubmit: (values: EventFormValues) => void;
  onCancel: () => void;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fromLocalInput(value: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateToLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Default end = start + 1 hour. */
function endOneHourAfter(startLocal: string): string {
  const d = fromLocalInput(startLocal);
  if (!d) return "";
  d.setHours(d.getHours() + 1);
  return dateToLocalInput(d);
}

function isEndBeforeStart(startLocal: string, endLocal: string): boolean {
  const s = fromLocalInput(startLocal);
  const e = fromLocalInput(endLocal);
  if (!s || !e) return false;
  return e.getTime() < s.getTime();
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function LabelWithTip({
  label,
  tip,
}: {
  label: string;
  tip?: string;
}) {
  return (
    <span className="label-row">
      <span>{label}</span>
      {tip ? <HelpTip text={tip} /> : null}
    </span>
  );
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
  const [rsvpOptions, setRsvpOptions] = useState<RsvpOption[]>(
    initial?.rsvpOptions?.length
      ? initial.rsvpOptions
      : defaultRsvpOptions(),
  );
  const [rsvpCloseBeforeMinutes, setRsvpCloseBeforeMinutes] =
    useState<RsvpCloseBeforeMinutes>(
      normalizeRsvpCloseBefore(initial?.rsvpCloseBeforeMinutes),
    );
  const [remindBefore, setRemindBefore] = useState<number[]>(
    initial?.remindBefore?.length ? initial.remindBefore : [60, 1440],
  );
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    initial?.photoUrl ?? null,
  );
  const [photoBase64, setPhotoBase64] = useState<string | undefined>();
  const [photoMime, setPhotoMime] = useState<string | undefined>();
  const [clearPhoto, setClearPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  const picked =
    locationLat != null && locationLng != null
      ? {
          name: location || `${locationLat}, ${locationLng}`,
          lat: locationLat,
          lng: locationLng,
        }
      : null;

  function toggleReminder(minutes: number) {
    setRemindBefore((prev) =>
      prev.includes(minutes)
        ? prev.filter((m) => m !== minutes)
        : [...prev, minutes].sort((a, b) => a - b),
    );
  }

  function onStartsAtChange(value: string) {
    setStartsAt(value);
    if (!value) return;
    // Always default end to 1 hour after the chosen start.
    setEndsAt(endOneHourAfter(value));
  }

  function onEndsAtChange(value: string) {
    if (!value) {
      setEndsAt("");
      return;
    }
    if (startsAt && isEndBeforeStart(startsAt, value)) {
      // Never allow end before start.
      setEndsAt(startsAt);
      return;
    }
    setEndsAt(value);
  }

  async function onPhotoPick(file: File | null) {
    setPhotoError(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError(t(locale, "photoTooLarge"));
      return;
    }
    setPhotoBusy(true);
    try {
      const compressed = await compressEventPhoto(file);
      setPhotoBase64(compressed.base64);
      setPhotoMime(compressed.mime);
      setClearPhoto(false);
      setPhotoPreview(`data:${compressed.mime};base64,${compressed.base64}`);
    } catch {
      setPhotoError(t(locale, "photoTooLarge"));
    } finally {
      setPhotoBusy(false);
    }
  }

  function onPhotoRemove() {
    setPhotoBase64(undefined);
    setPhotoMime(undefined);
    setPhotoPreview(null);
    setClearPhoto(Boolean(initial?.hasPhoto || initial?.photoUrl));
    setPhotoError(null);
  }

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        let endValue = endsAt;
        if (startsAt && endValue && isEndBeforeStart(startsAt, endValue)) {
          endValue = startsAt;
          setEndsAt(endValue);
        }
        if (startsAt && !endValue) {
          endValue = endOneHourAfter(startsAt);
        }
        onSubmit({
          title: trimmed,
          description,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: endValue ? new Date(endValue).toISOString() : "",
          allDay,
          location,
          locationLat,
          locationLng,
          emoji,
          rsvpPublic,
          rsvpLocked,
          rsvpOptions,
          rsvpCloseBeforeMinutes,
          remindBefore,
          timezone: browserTimezone(),
          ...(photoBase64 && photoMime
            ? { photoBase64, photoMime }
            : clearPhoto
              ? { clearPhoto: true }
              : {}),
        });
      }}
    >
      <label>
        <LabelWithTip label={t(locale, "emoji")} tip={t(locale, "emojiTip")} />
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
        <LabelWithTip label={t(locale, "title")} tip={t(locale, "titleTip")} />
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t(locale, "title")}
        />
      </label>

      <label>
        <LabelWithTip
          label={t(locale, "description")}
          tip={t(locale, "descriptionTip")}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(locale, "optional")}
        />
      </label>

      <fieldset className="fieldset">
        <legend>
          <span className="label-row">
            <span>{t(locale, "photo")}</span>
            <HelpTip text={t(locale, "photoTip")} />
          </span>
        </legend>
        {photoPreview && (
          <img
            src={photoPreview}
            alt=""
            className="event-photo-preview"
          />
        )}
        <div className="photo-actions">
          <label className="btn ghost">
            {photoPreview ? t(locale, "photoChange") : t(locale, "photoPick")}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={photoBusy || submitting}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                void onPhotoPick(file);
              }}
            />
          </label>
          {photoPreview && (
            <button
              type="button"
              className="btn danger"
              disabled={photoBusy || submitting}
              onClick={onPhotoRemove}
            >
              {t(locale, "photoRemove")}
            </button>
          )}
        </div>
        {photoBusy && <p className="hint">{t(locale, "loading")}</p>}
        {photoError && <p className="error">{photoError}</p>}
      </fieldset>

      <div className="form-row">
        <label>
          {t(locale, "startsAt")}
          <input
            required
            type="datetime-local"
            value={startsAt}
            onChange={(e) => onStartsAtChange(e.target.value)}
          />
        </label>
        <label>
          {t(locale, "endsAt")}
          <input
            type="datetime-local"
            value={endsAt}
            min={startsAt || undefined}
            onChange={(e) => onEndsAtChange(e.target.value)}
          />
        </label>
      </div>

      <label className="check">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(e) => setAllDay(e.target.checked)}
        />
        {t(locale, "allDay")}
      </label>

      <fieldset className="fieldset">
        <legend>
          <span className="label-row">
            <span>{t(locale, "location")}</span>
            <HelpTip text={t(locale, "locationOptionalTip")} />
          </span>
        </legend>
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

      <fieldset className="fieldset">
        <legend>
          <span className="label-row">
            <span>{t(locale, "reminders")}</span>
            <HelpTip text={t(locale, "remindersTip")} />
          </span>
        </legend>
        <div className="check-list">
          {REMINDER_OPTIONS.map((opt) => (
            <label key={opt.minutes} className="check">
              <input
                type="checkbox"
                checked={remindBefore.includes(opt.minutes)}
                onChange={() => toggleReminder(opt.minutes)}
              />
              {t(locale, opt.key)}
            </label>
          ))}
        </div>
      </fieldset>

      <RsvpOptionsEditor
        locale={locale}
        value={rsvpOptions}
        onChange={setRsvpOptions}
      />

      <fieldset className="fieldset">
        <legend>
          <span className="label-row">
            <span>{t(locale, "rsvpDeadline")}</span>
            <HelpTip text={t(locale, "rsvpDeadlineTip")} />
          </span>
        </legend>
        <div className="check-list">
          {RSVP_DEADLINE_OPTIONS.filter((opt) =>
            (RSVP_CLOSE_BEFORE_CHOICES as readonly number[]).includes(
              opt.minutes,
            ),
          ).map((opt) => (
            <label key={opt.minutes} className="check">
              <input
                type="radio"
                name="rsvpCloseBefore"
                checked={rsvpCloseBeforeMinutes === opt.minutes}
                onChange={() => setRsvpCloseBeforeMinutes(opt.minutes)}
              />
              {t(locale, opt.key)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={rsvpPublic}
          onChange={(e) => setRsvpPublic(e.target.checked)}
        />
        <span className="label-row">
          <span>{t(locale, "rsvpPublic")}</span>
          <HelpTip
            text={
              rsvpPublic
                ? t(locale, "rsvpPublicHint")
                : t(locale, "rsvpPrivateHint")
            }
          />
        </span>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={rsvpLocked}
          onChange={(e) => setRsvpLocked(e.target.checked)}
        />
        <span className="label-row">
          <span>{t(locale, "rsvpLocked")}</span>
          <HelpTip
            text={
              rsvpLocked
                ? t(locale, "rsvpLockedHint")
                : t(locale, "rsvpUnlockedHint")
            }
          />
        </span>
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
