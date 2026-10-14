export type RsvpOptionKind = "yes" | "no" | "extra";

export interface RsvpOption {
  id: string;
  kind: RsvpOptionKind;
  label: string;
  emoji: string;
  order: number;
}

/** Compact icon list for RSVP buttons (pick from a scrollable list in UI). */
export const RSVP_ICON_CHOICES = [
  "✅",
  "❌",
  "👍",
  "👎",
  "🤔",
  "🙌",
  "👏",
  "🔥",
  "💯",
  "🎉",
  "🥳",
  "❤️",
  "💙",
  "💚",
  "💜",
  "🧡",
  "⭐",
  "✨",
  "🎯",
  "🚀",
  "🏃",
  "🏠",
  "🚗",
  "☕",
  "🍕",
  "🎮",
  "🎵",
  "📚",
  "💼",
  "🙏",
  "😅",
  "😢",
  "😴",
  "🤝",
  "👋",
  "🫡",
] as const;

export function defaultRsvpOptions(): RsvpOption[] {
  return [
    { id: "yes", kind: "yes", label: "Yes", emoji: "✅", order: 0 },
    { id: "no", kind: "no", label: "No", emoji: "❌", order: 1 },
  ];
}

function newExtraId(): string {
  return `x${Math.random().toString(36).slice(2, 10)}`;
}

export function createExtraOption(
  partial?: Partial<Pick<RsvpOption, "label" | "emoji" | "order">>,
): RsvpOption {
  return {
    id: newExtraId(),
    kind: "extra",
    label: partial?.label?.trim() || "Maybe",
    emoji: partial?.emoji || "🤔",
    order: partial?.order ?? 2,
  };
}

/** Ensure yes/no exist, extras are valid, orders are sequential. */
export function normalizeRsvpOptions(raw: unknown): RsvpOption[] {
  const defaults = defaultRsvpOptions();
  const list = Array.isArray(raw) ? raw : [];

  let yes: RsvpOption | null = null;
  let no: RsvpOption | null = null;
  const extras: RsvpOption[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = o.kind === "yes" || o.kind === "no" || o.kind === "extra" ? o.kind : null;
    if (!kind) continue;
    const label =
      typeof o.label === "string" && o.label.trim() ? o.label.trim().slice(0, 40) : null;
    const emoji =
      typeof o.emoji === "string" && o.emoji.trim() ? o.emoji.trim().slice(0, 8) : "•";
    const id =
      typeof o.id === "string" && o.id.trim() && !o.id.includes(":")
        ? o.id.trim().slice(0, 32)
        : kind === "extra"
          ? newExtraId()
          : kind;
    const order = typeof o.order === "number" && Number.isFinite(o.order) ? o.order : 0;
    const opt: RsvpOption = {
      id: kind === "yes" ? "yes" : kind === "no" ? "no" : id,
      kind,
      label: label || (kind === "yes" ? "Yes" : kind === "no" ? "No" : "Option"),
      emoji,
      order,
    };
    if (kind === "yes") yes = opt;
    else if (kind === "no") no = opt;
    else extras.push(opt);
  }

  yes = yes ?? defaults[0]!;
  no = no ?? defaults[1]!;
  yes = { ...yes, id: "yes", kind: "yes" };
  no = { ...no, id: "no", kind: "no" };

  const seen = new Set<string>(["yes", "no"]);
  const uniqueExtras = extras.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  const sorted = [yes, no, ...uniqueExtras].sort((a, b) => {
    if (a.kind === "yes") return -1;
    if (b.kind === "yes") return 1;
    if (a.kind === "no" && b.kind === "extra") return -1;
    if (b.kind === "no" && a.kind === "extra") return 1;
    return a.order - b.order;
  });

  // Re-number: yes first, no second, then extras by relative order
  const yesOpt = sorted.find((o) => o.kind === "yes")!;
  const noOpt = sorted.find((o) => o.kind === "no")!;
  const extraOpts = sorted
    .filter((o) => o.kind === "extra")
    .sort((a, b) => a.order - b.order)
    .map((o, i) => ({ ...o, order: i + 2 }));

  return [
    { ...yesOpt, order: 0 },
    { ...noOpt, order: 1 },
    ...extraOpts,
  ];
}

export function optionButtonText(opt: RsvpOption, count: number): string {
  return `${opt.emoji} ${opt.label} (${count})`;
}

export function countsByOptionId(
  options: RsvpOption[],
  votes: { optionId: string | null; status?: string | null }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const o of options) counts[o.id] = 0;
  for (const v of votes) {
    const id = resolveVoteOptionId(options, v.optionId, v.status);
    if (id && counts[id] !== undefined) counts[id] += 1;
    else if (id) counts[id] = 1;
  }
  return counts;
}

/** Map legacy status or missing optionId onto current options. */
export function resolveVoteOptionId(
  options: RsvpOption[],
  optionId: string | null | undefined,
  status?: string | null,
): string | null {
  if (optionId && options.some((o) => o.id === optionId)) return optionId;
  if (status === "going") return options.find((o) => o.kind === "yes")?.id ?? "yes";
  if (status === "not_going") return options.find((o) => o.kind === "no")?.id ?? "no";
  if (status === "maybe") {
    return (
      options.find((o) => o.kind === "extra" && o.id === "maybe")?.id ??
      options.find((o) => o.kind === "extra")?.id ??
      null
    );
  }
  return null;
}

export function icsStatusFromOption(
  opt: RsvpOption | undefined,
): "going" | "maybe" | "not_going" {
  if (!opt) return "maybe";
  if (opt.kind === "yes") return "going";
  if (opt.kind === "no") return "not_going";
  return "maybe";
}

export function buildRsvpKeyboardRows(
  eventId: string,
  options: RsvpOption[],
  counts: Record<string, number>,
): { text: string; callback_data: string }[][] {
  const sorted = [...options].sort((a, b) => a.order - b.order);
  const rows: { text: string; callback_data: string }[][] = [];
  // Put yes+no on first row when possible; extras wrap 2 per row
  const yes = sorted.find((o) => o.kind === "yes");
  const no = sorted.find((o) => o.kind === "no");
  const extras = sorted.filter((o) => o.kind === "extra");

  if (yes && no) {
    rows.push([
      {
        text: optionButtonText(yes, counts[yes.id] ?? 0),
        callback_data: `rsvp:${eventId}:${yes.id}`,
      },
      {
        text: optionButtonText(no, counts[no.id] ?? 0),
        callback_data: `rsvp:${eventId}:${no.id}`,
      },
    ]);
  }
  for (let i = 0; i < extras.length; i += 2) {
    const chunk = extras.slice(i, i + 2);
    rows.push(
      chunk.map((o) => ({
        text: optionButtonText(o, counts[o.id] ?? 0),
        callback_data: `rsvp:${eventId}:${o.id}`,
      })),
    );
  }
  return rows;
}
