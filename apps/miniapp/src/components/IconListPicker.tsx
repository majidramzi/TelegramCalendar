import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  choices: readonly string[];
  onChange: (emoji: string) => void;
  ariaLabel?: string;
}

/** Compact emoji picker: one button opens a scrollable list (not a full grid). */
export function IconListPicker({
  value,
  choices,
  onChange,
  ariaLabel = "Choose icon",
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent | TouchEvent) {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
    };
  }, [open]);

  return (
    <div className="icon-list-picker" ref={rootRef}>
      <button
        type="button"
        className="icon-list-trigger"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="icon-list-current">{value}</span>
        <span className="icon-list-caret">▾</span>
      </button>
      {open && (
        <ul className="icon-list-menu" role="listbox">
          {choices.map((emoji) => (
            <li key={emoji}>
              <button
                type="button"
                className={emoji === value ? "active" : ""}
                role="option"
                aria-selected={emoji === value}
                onClick={() => {
                  onChange(emoji);
                  setOpen(false);
                }}
              >
                {emoji}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
