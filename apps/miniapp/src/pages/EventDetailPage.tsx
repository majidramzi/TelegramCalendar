import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { EventDto } from "@tg-cal/shared";
import { normalizeRsvpOptions } from "@tg-cal/shared/rsvpOptions";
import {
  isRsvpOpen,
  normalizeRsvpCloseBefore,
} from "@tg-cal/shared/rsvpWindow";
import { deleteEvent, fetchEvent, setRsvp } from "../api";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { HelpTip } from "../components/HelpTip";
import { openInMaps } from "../maps";

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

  async function onRsvp(optionId: string) {
    if (!id) return;
    setBusy(true);
    try {
      const r = await setRsvp(id, optionId);
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

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(locale === "fa" ? "fa-IR" : "en-GB", {
      dateStyle: "full",
      timeStyle: event.allDay ? undefined : "short",
    });

  const options = normalizeRsvpOptions(event.rsvpOptions);
  const counts = event.rsvpCounts ?? {};
  const hasMap = event.locationLat != null && event.locationLng != null;
  const voters = event.rsvpVoters;
  const myOptionId = event.myOptionId;
  const closeBefore = normalizeRsvpCloseBefore(event.rsvpCloseBeforeMinutes);
  const rsvpOpen =
    event.rsvpOpen ?? isRsvpOpen(event.startsAt, closeBefore);
  const pastStart = Date.now() >= new Date(event.startsAt).getTime();

  return (
    <div className="detail">
      <h2>
        {event.emoji || "📢"} {event.title}
      </h2>
      {event.hasPhoto && event.photoUrl && (
        <img
          src={event.photoUrl}
          alt=""
          className="event-photo"
        />
      )}
      <div className="meta">
        <div>
          {t(locale, "startsAt")}: {fmt(event.startsAt)}
        </div>
        {event.endsAt && (
          <div>
            {t(locale, "endsAt")}: {fmt(event.endsAt)}
          </div>
        )}
      </div>
      {event.location && !hasMap && <p>📍 {event.location}</p>}
      {hasMap && (
        <button
          type="button"
          className="map-link"
          onClick={() =>
            openInMaps(event.locationLat!, event.locationLng!, event.location)
          }
        >
          📍 {event.location || t(locale, "openMap")}
        </button>
      )}
      {event.description && <p>{event.description}</p>}

      <h3 className="label-row">
        <span>{t(locale, "rsvp")}</span>
        <HelpTip
          text={[
            event.rsvpPublic
              ? t(locale, "rsvpPublicHint")
              : t(locale, "rsvpPrivateHint"),
            event.rsvpLocked
              ? t(locale, "rsvpLockedHint")
              : t(locale, "rsvpUnlockedHint"),
          ].join(" ")}
        />
      </h3>
      <div className="rsvp-row">
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={`btn ghost${myOptionId === opt.id ? " active" : ""}`}
            disabled={busy || !rsvpOpen}
            onClick={() => onRsvp(opt.id)}
          >
            {opt.emoji} {opt.label} ({counts[opt.id] ?? 0})
          </button>
        ))}
      </div>
      {!rsvpOpen && (
        <p className="hint">
          {pastStart ? t(locale, "rsvpClosedPast") : t(locale, "rsvpClosed")}
        </p>
      )}

      {event.rsvpPublic && voters && (
        <div>
          {options.map((opt) => {
            const names = voters[opt.id] ?? [];
            return (
              <div key={opt.id}>
                <h4>
                  {opt.emoji} {opt.label} ({names.length})
                </h4>
                {names.length > 0 ? (
                  <ul className="voter-list">
                    {names.map((n) => (
                      <li key={`${opt.id}-${n}`}>{n}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="hint">—</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <div className="actions">
        {event.canManage && (
          <>
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
          </>
        )}
        <Link to="/" className="btn ghost">
          {t(locale, "back")}
        </Link>
      </div>
    </div>
  );
}
