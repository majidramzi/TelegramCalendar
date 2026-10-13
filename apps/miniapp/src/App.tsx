import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { fetchChat, getStartAppToken, type ChatInfo } from "./api";
import { detectLocale, t, type Locale } from "./i18n";
import { applyTelegramTheme } from "./theme";
import { HomePage } from "./pages/HomePage";
import { EventDetailPage } from "./pages/EventDetailPage";
import { EventEditPage } from "./pages/EventEditPage";

export function App() {
  const [locale, setLocale] = useState<Locale>("en");
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    applyTelegramTheme();
    const lang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
    const loc = detectLocale(lang);
    setLocale(loc);
    document.documentElement.lang = loc;
    document.documentElement.dir = loc === "fa" ? "rtl" : "ltr";

    const token = getStartAppToken();
    if (!token) {
      setError(t(loc, "missingChat"));
      setReady(true);
      return;
    }

    fetchChat()
      .then((c) => setChat(c))
      .catch((e: Error) => setError(e.message))
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="app">
        <p className="hint">{t(locale, "loading")}</p>
      </div>
    );
  }

  if (error || !chat) {
    return (
      <div className="app">
        <p className="hint">{error ?? t(locale, "missingChat")}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<HomePage locale={locale} chat={chat} />} />
        <Route
          path="/event/:id"
          element={<EventDetailPage locale={locale} />}
        />
        <Route
          path="/event/:id/edit"
          element={<EventEditPage locale={locale} mode="edit" />}
        />
        <Route
          path="/new"
          element={<EventEditPage locale={locale} mode="create" />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
