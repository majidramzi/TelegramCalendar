import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { EventDto } from "@tg-cal/shared";
import { createEvent, fetchEvent, updateEvent } from "../api";
import { EventForm, type EventFormValues } from "../components/EventForm";
import type { Locale } from "../i18n";
import { t } from "../i18n";

interface Props {
  locale: Locale;
  mode: "create" | "edit";
}

export function EventEditPage({ locale, mode }: Props) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [initial, setInitial] = useState<EventDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode !== "edit" || !id) return;
    fetchEvent(id)
      .then((r) => setInitial(r.event))
      .catch((e: Error) => setError(e.message));
  }, [mode, id]);

  useEffect(() => {
    const wa = window.Telegram?.WebApp;
    if (!wa) return;
    const onBack = () => navigate(-1);
    wa.BackButton.show();
    wa.BackButton.onClick(onBack);
    return () => {
      wa.BackButton.offClick(onBack);
      wa.BackButton.hide();
    };
  }, [navigate]);

  async function onSubmit(values: EventFormValues) {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        title: values.title,
        description: values.description || null,
        startsAt: values.startsAt,
        endsAt: values.endsAt || null,
        allDay: values.allDay,
        location: values.location || null,
        locationLat: values.locationLat,
        locationLng: values.locationLng,
        emoji: values.emoji,
        rsvpPublic: values.rsvpPublic,
        rsvpLocked: values.rsvpLocked,
        timezone: values.timezone,
      };
      const result =
        mode === "create"
          ? await createEvent(body)
          : await updateEvent(id!, body);
      navigate(`/event/${result.event.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  if (mode === "edit" && !initial && !error) {
    return <p className="hint">{t(locale, "loading")}</p>;
  }

  return (
    <div>
      <h2>{mode === "create" ? t(locale, "create") : t(locale, "edit")}</h2>
      {error && <p className="error">{error}</p>}
      <EventForm
        locale={locale}
        initial={
          initial
            ? {
                title: initial.title,
                description: initial.description ?? "",
                startsAt: initial.startsAt,
                endsAt: initial.endsAt ?? "",
                allDay: initial.allDay,
                location: initial.location ?? "",
                locationLat: initial.locationLat,
                locationLng: initial.locationLng,
                emoji: initial.emoji,
                rsvpPublic: initial.rsvpPublic,
                rsvpLocked: initial.rsvpLocked,
              }
            : undefined
        }
        submitting={submitting}
        onSubmit={onSubmit}
        onCancel={() => navigate(-1)}
      />
    </div>
  );
}
