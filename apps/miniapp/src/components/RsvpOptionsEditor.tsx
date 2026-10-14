import {
  createExtraOption,
  defaultRsvpOptions,
  normalizeRsvpOptions,
  RSVP_ICON_CHOICES,
  type RsvpOption,
} from "@tg-cal/shared/rsvpOptions";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { HelpTip } from "./HelpTip";
import { IconListPicker } from "./IconListPicker";

interface Props {
  locale: Locale;
  value: RsvpOption[];
  onChange: (next: RsvpOption[]) => void;
}

export function RsvpOptionsEditor({ locale, value, onChange }: Props) {
  const options = normalizeRsvpOptions(value.length ? value : defaultRsvpOptions());
  const yes = options.find((o) => o.kind === "yes")!;
  const no = options.find((o) => o.kind === "no")!;
  const extras = options
    .filter((o) => o.kind === "extra")
    .sort((a, b) => a.order - b.order);

  function commit(next: RsvpOption[]) {
    onChange(normalizeRsvpOptions(next));
  }

  function patch(id: string, patch: Partial<RsvpOption>) {
    commit(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }

  function moveExtra(id: string, dir: -1 | 1) {
    const idx = extras.findIndex((o) => o.id === id);
    const swap = idx + dir;
    if (idx < 0 || swap < 0 || swap >= extras.length) return;
    const nextExtras = [...extras];
    const a = nextExtras[idx]!;
    const b = nextExtras[swap]!;
    nextExtras[idx] = { ...b, order: a.order };
    nextExtras[swap] = { ...a, order: b.order };
    commit([yes, no, ...nextExtras]);
  }

  function removeExtra(id: string) {
    commit([yes, no, ...extras.filter((o) => o.id !== id)]);
  }

  function addExtra() {
    commit([
      yes,
      no,
      ...extras,
      createExtraOption({
        label: t(locale, "rsvpExtraDefault"),
        emoji: "🤔",
        order: extras.length + 2,
      }),
    ]);
  }

  return (
    <fieldset className="fieldset">
      <legend>
        <span className="label-row">
          <span>{t(locale, "rsvpOptions")}</span>
          <HelpTip text={t(locale, "rsvpOptionsTip")} />
        </span>
      </legend>

      <div className="rsvp-opt-row required">
        <span className="rsvp-opt-badge">{t(locale, "required")}</span>
        <IconListPicker
          value={yes.emoji}
          choices={RSVP_ICON_CHOICES}
          onChange={(emoji) => patch(yes.id, { emoji })}
        />
        <input
          value={yes.label}
          onChange={(e) => patch(yes.id, { label: e.target.value })}
          aria-label={t(locale, "rsvpYes")}
        />
      </div>

      <div className="rsvp-opt-row required">
        <span className="rsvp-opt-badge">{t(locale, "required")}</span>
        <IconListPicker
          value={no.emoji}
          choices={RSVP_ICON_CHOICES}
          onChange={(emoji) => patch(no.id, { emoji })}
        />
        <input
          value={no.label}
          onChange={(e) => patch(no.id, { label: e.target.value })}
          aria-label={t(locale, "rsvpNo")}
        />
      </div>

      {extras.map((opt, index) => (
        <div className="rsvp-opt-row" key={opt.id}>
          <span className="rsvp-opt-badge optional">{t(locale, "optional")}</span>
          <IconListPicker
            value={opt.emoji}
            choices={RSVP_ICON_CHOICES}
            onChange={(emoji) => patch(opt.id, { emoji })}
          />
          <input
            value={opt.label}
            onChange={(e) => patch(opt.id, { label: e.target.value })}
          />
          <div className="rsvp-opt-actions">
            <button
              type="button"
              className="btn ghost tiny"
              disabled={index === 0}
              onClick={() => moveExtra(opt.id, -1)}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              className="btn ghost tiny"
              disabled={index === extras.length - 1}
              onClick={() => moveExtra(opt.id, 1)}
              aria-label="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              className="btn danger tiny"
              onClick={() => removeExtra(opt.id)}
            >
              ×
            </button>
          </div>
        </div>
      ))}

      <button type="button" className="btn ghost" onClick={addExtra}>
        {t(locale, "addRsvpOption")}
      </button>
    </fieldset>
  );
}
