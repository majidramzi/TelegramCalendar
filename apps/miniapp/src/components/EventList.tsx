import { Link } from "react-router-dom";
import type { EventDto } from "@tg-cal/shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";

interface Props {
  locale: Locale;
  events: EventDto[];
  emptyLabel?: string;
}

export function EventList({ locale, events, emptyLabel }: Props) {
  if (!events.length) {
    return <p className="hint">{emptyLabel ?? t(locale, "noEvents")}</p>;
  }

  return (
    <div className="list">
      {events.map((e) => {
        const d = new Date(e.startsAt);
        const when = d.toLocaleString(locale === "fa" ? "fa-IR" : "en-GB", {
          dateStyle: "medium",
          timeStyle: e.allDay ? undefined : "short",
        });
        return (
          <Link key={e.id} to={`/event/${e.id}`} className="event-row">
            <div className="title">{e.title}</div>
            <div className="meta">{when}</div>
          </Link>
        );
      })}
    </div>
  );
}
