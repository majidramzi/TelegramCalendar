import type { EventDto } from "@tg-cal/shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";

interface Props {
  locale: Locale;
  year: number;
  month: number; // 0-11
  selected: Date;
  events: EventDto[];
  onSelect: (d: Date) => void;
  onMonthChange: (year: number, month: number) => void;
}

function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function MonthView({
  locale,
  year,
  month,
  selected,
  events,
  onSelect,
  onMonthChange,
}: Props) {
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();

  const cells: { date: Date; muted: boolean }[] = [];
  for (let i = startDow - 1; i >= 0; i--) {
    cells.push({
      date: new Date(year, month - 1, prevDays - i),
      muted: true,
    });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), muted: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1]!.date;
    cells.push({
      date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1),
      muted: true,
    });
  }

  const eventDays = new Set(
    events.map((e) => {
      const d = new Date(e.startsAt);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }),
  );

  const title = first.toLocaleDateString(locale === "fa" ? "fa-IR" : "en-US", {
    month: "long",
    year: "numeric",
  });

  const dows =
    locale === "fa"
      ? ["ی", "د", "س", "چ", "پ", "ج", "ش"]
      : ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div>
      <div className="month-nav">
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            const m = month - 1;
            onMonthChange(m < 0 ? year - 1 : year, (m + 12) % 12);
          }}
        >
          ‹
        </button>
        <strong>{title}</strong>
        <button
          type="button"
          className="btn ghost"
          onClick={() => {
            const m = month + 1;
            onMonthChange(m > 11 ? year + 1 : year, m % 12);
          }}
        >
          ›
        </button>
      </div>
      <div className="month-grid" aria-label={t(locale, "month")}>
        {dows.map((d, i) => (
          <div key={i} className="dow">
            {d}
          </div>
        ))}
        {cells.map(({ date, muted }) => {
          const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          const has = eventDays.has(key);
          const sel = sameDay(date, selected);
          return (
            <button
              key={key + (muted ? "m" : "")}
              type="button"
              className={`day${muted ? " muted" : ""}${sel ? " selected" : ""}${has ? " has-event" : ""}`}
              onClick={() => onSelect(date)}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
