import type { RsvpOption } from "./rsvpOptions.js";

export type { RsvpOption, RsvpOptionKind } from "./rsvpOptions.js";

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
  rsvpOptions: RsvpOption[];
  /** Minutes before start when RSVP closes (0 = until start). */
  rsvpCloseBeforeMinutes: number;
  /** True when an image is stored for this event. */
  hasPhoto: boolean;
  /** Public URL to fetch the event image (null if none). */
  photoUrl: string | null;
  createdBy: string;
  remindBefore: number[];
  /** Counts keyed by option id. */
  rsvpCounts?: Record<string, number>;
  /** Present only when rsvpPublic is true; names keyed by option id. */
  rsvpVoters?: Record<string, string[]>;
  myRsvp?: RsvpStatus | null;
  myOptionId?: string | null;
  /** True when the current user may edit/delete (creator or chat admin). */
  canManage?: boolean;
  /** False when event started or RSVP deadline passed. */
  rsvpOpen?: boolean;
}
