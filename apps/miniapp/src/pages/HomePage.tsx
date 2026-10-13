import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { EventDto } from "@tg-cal/shared";
import { fetchEvents, fetchIcsUrl, type ChatInfo } from "../api";
import { MonthView } from "../components/MonthView";
import { EventList } from "../components/EventList";
import type { Locale } from "../i18n";
import { t } from "../i18n";

interface Props {
  locale: Locale;
  chat: ChatInfo;
}

export function HomePage({ locale, chat }: Props) {
  const [tab, setTab] = useState<"month" | "upcoming">("month");
  const [events, setEvents] = useState<EventDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(now);
  const [icsUrl, setIcsUrl] = useState<string | null>(null);

  useEffect(() => {
    const from = new Date(year, month, 1).toISOString();
    const to = new Date(year, month + 1, 0, 23, 59, 59).toISOString();
    setLoading(true);
    fetchEvents({ from, to })
      .then((r) => setEvents(r.events))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => {
    fetchIcsUrl()
      .then((r) => setIcsUrl(r.url))
      .catch(() => setIcsUrl(null));
  }, []);

  const dayEvents = useMemo(() => {
    return events.filter((e) => {
      const d = new Date(e.startsAt);
      return (
        d.getFullYear() === selected.getFullYear() &&
        d.getMonth() === selected.getMonth() &&
        d.getDate() === selected.getDate()
      );
    });
  }, [events, selected]);

  const upcoming = useMemo(() => {
    const t0 = Date.now() - 60 * 60_000;
    return events
      .filter((e) => new Date(e.startsAt).getTime() >= t0)
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
      );
  }, [events]);

  return (
    <div>
      <div className="header">
        <h1>{chat.title || t(locale, "appTitle")}</h1>
        <Link to="/new" className="btn">
          {t(locale, "create")}
        </Link>
      </div>

      <div className="tabs">
        <button
          type="button"
          className={tab === "month" ? "active" : ""}
          onClick={() => setTab("month")}
        >
          {t(locale, "month")}
        </button>
        <button
          type="button"
          className={tab === "upcoming" ? "active" : ""}
          onClick={() => setTab("upcoming")}
        >
          {t(locale, "upcoming")}
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="hint">{t(locale, "loading")}</p>}

      {!loading && tab === "month" && (
        <>
          <MonthView
            locale={locale}
            year={year}
            month={month}
            selected={selected}
            events={events}
            onSelect={setSelected}
            onMonthChange={(y, m) => {
              setYear(y);
              setMonth(m);
            }}
          />
          <div style={{ marginTop: 14 }}>
            <EventList locale={locale} events={dayEvents} />
          </div>
        </>
      )}

      {!loading && tab === "upcoming" && (
        <EventList locale={locale} events={upcoming} />
      )}

      {icsUrl && (
        <p className="hint" style={{ marginTop: 20 }}>
          <a href={icsUrl} style={{ color: "var(--tg-link)" }}>
            {t(locale, "ics")}
          </a>
        </p>
      )}
    </div>
  );
}
