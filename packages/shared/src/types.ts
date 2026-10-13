export type PermissionMode = "admins_only" | "all_members";

export type ChatType = "group" | "supergroup" | "channel";

export type RsvpStatus = "going" | "maybe" | "not_going";

export interface StartAppPayload {
  chatId: string;
  exp: number;
}

export interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export interface ValidatedInitData {
  user: TelegramWebAppUser;
  authDate: number;
  queryId?: string;
  startParam?: string;
  chatInstance?: string;
  chatType?: string;
  raw: Record<string, string>;
}

export interface EventDto {
  id: string;
  chatId: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  locationLat: number | null;
  locationLng: number | null;
  emoji: string;
  rsvpPublic: boolean;
  rsvpLocked: boolean;
  createdBy: string;
  remindBefore: number[];
  rsvpCounts?: Record<RsvpStatus, number>;
  /** Present only when rsvpPublic is true. */
  rsvpVoters?: Partial<Record<RsvpStatus, string[]>>;
  myRsvp?: RsvpStatus | null;
}
