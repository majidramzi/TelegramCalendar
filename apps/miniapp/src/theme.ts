export function applyTelegramTheme(): void {
  const wa = window.Telegram?.WebApp;
  if (!wa) return;

  wa.ready();
  wa.expand();

  const tp = wa.themeParams;
  const root = document.documentElement;
  root.dataset.colorScheme = wa.colorScheme;

  const map: Record<string, string | undefined> = {
    "--tg-bg": tp.bg_color,
    "--tg-text": tp.text_color,
    "--tg-hint": tp.hint_color,
    "--tg-link": tp.link_color,
    "--tg-button": tp.button_color,
    "--tg-button-text": tp.button_text_color,
    "--tg-secondary": tp.secondary_bg_color,
  };

  for (const [key, value] of Object.entries(map)) {
    if (value) root.style.setProperty(key, value);
  }

  if (tp.bg_color) {
    try {
      wa.setBackgroundColor(tp.bg_color);
      wa.setHeaderColor(tp.bg_color);
    } catch {
      // older clients
    }
  }
}
