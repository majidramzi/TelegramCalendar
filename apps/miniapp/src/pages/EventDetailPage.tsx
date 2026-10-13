import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { EventDto, RsvpStatus } from "@tg-cal/shared";
import { deleteEvent, fetchEvent, setRsvp } from "../api";
import type { Locale } from "../i18n";
import { t } from "../i18n";

interface Props {
  locale: Locale;
}

export function EventDetailPage({ locale }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchEvent(id)
      .then((r) => setEvent(r.event))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    const onBack = () => navigate("/");
    wa.BackButton.show();
    wa.BackButton.onClick(onBack);
    return () => {
      wa.BackButton.offClick(onBack);
      wa.BackButton.hide();
    };
  }, [navigate]);

  async function onRsvp(status: RsvpStatus) {
    if (!id) return;
    setBusy(true);
    try {
      const r = await setRsvp(id, status);
      setEvent(r.event);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!id || !confirm(t(locale, "delete") + "?")) return;
    setBusy(true);
    try {
      await deleteEvent(id);
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!event && !error) {
    return <p className="hint">{t(locale, "loading")}</p>;
  }
  if (!event) {
    return <p className="error">{error ?? t(locale, "error")}</p>;
  }

  const when = new Date(event.startsAt).toLocaleString(
    locale === "fa" ? "fa-IR" : "en-GB",
    {
      dateStyle: "full",
      timeStyle: event.allDay ? undefined : "short",
    },
  );

  const counts = event.rsvpCounts ?? { going: 0, maybe: 0, not_going: 0 };

  return (
    <div className="detail">
      <h2>{event.title}</h2>
      <div className="meta">{when}</div>
      {event.location && <p>📍 {event.location}</p>}
      {event.description && <p>{event.description}</p>}

      <h3>{t(locale, "rsvp")}</h3>
      <div className="rsvp-row">
        <button
          type="button"
          className={`btn ghost${event.myRsvp === "going" ? " active" : ""}`}
          disabled={busy}
          onClick={() => onRsvp("going")}
        >
          {t(locale, "going")} ({counts.going})
        </button>
        <button
          type="button"
          className={`btn ghost${event.myRsvp === "maybe" ? " active" : ""}`}
          disabled={busy}
          onClick={() => onRsvp("maybe")}
        >
          {t(locale, "maybe")} ({counts.maybe})
        </button>
        <button
          type="button"
          className={`btn ghost${event.myRsvp === "not_going" ? " active" : ""}`}
          disabled={busy}
          onClick={() => onRsvp("not_going")}
        >
          {t(locale, "notGoing")} ({counts.not_going})
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="actions">
        <Link to={`/event/${event.id}/edit`} className="btn ghost">
          {t(locale, "edit")}
        </Link>
        <button
          type="button"
          className="btn danger"
          disabled={busy}
          onClick={onDelete}
        >
          {t(locale, "delete")}
        </button>
        <Link to="/" className="btn ghost">
          {t(locale, "back")}
        </Link>
      </div>
    </div>
  );
}
