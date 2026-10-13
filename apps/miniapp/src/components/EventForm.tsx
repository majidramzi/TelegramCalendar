import { useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";

export interface EventFormValues {
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string;
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
        });
      }}
    >
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
      <label>
        {t(locale, "location")}
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </label>
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
