export type Locale = "en" | "fa";

const strings = {
  en: {
    appTitle: "Calendar",
    month: "Month",
    upcoming: "Upcoming",
    noEvents: "No events",
    create: "New event",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    title: "Title",
    description: "Description",
    startsAt: "Starts",
    endsAt: "Ends",
    allDay: "All day",
    location: "Location",
    details: "Details",
    rsvp: "RSVP",
    going: "Going",
    maybe: "Maybe",
    notGoing: "Not going",
    loading: "Loading…",
    error: "Something went wrong",
    missingChat: "Open this app from the group calendar button.",
    ics: "Subscribe (ICS)",
    back: "Back",
  },
  fa: {
    appTitle: "تقویم",
    month: "ماه",
    upcoming: "آینده",
    noEvents: "رویدادی نیست",
    create: "رویداد جدید",
    edit: "ویرایش",
    delete: "حذف",
    save: "ذخیره",
    cancel: "لغو",
    title: "عنوان",
    description: "توضیحات",
    startsAt: "شروع",
    endsAt: "پایان",
    allDay: "تمام‌روز",
    location: "مکان",
    details: "جزئیات",
    rsvp: "حضور",
    going: "می‌آیم",
    maybe: "شاید",
    notGoing: "نمی‌آیم",
    loading: "در حال بارگذاری…",
    error: "خطایی رخ داد",
    missingChat: "این برنامه را از دکمه تقویم گروه باز کنید.",
    ics: "اشتراک ICS",
    back: "بازگشت",
  },
} as const;

export type MessageKey = keyof typeof strings.en;

export function detectLocale(languageCode?: string): Locale {
  if (languageCode?.toLowerCase().startsWith("fa")) return "fa";
  return "en";
}

export function t(locale: Locale, key: MessageKey): string {
  return strings[locale][key] ?? strings.en[key];
}
