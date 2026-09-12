export const MAX_COMMENT_LENGTH = 4000;
export const MAX_TIMECODE = 604800;

export interface AdLibraryComment {
  id: string;
  assetId: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  body: string;
  timecode: number | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdLibraryReview {
  comments: AdLibraryComment[];
  currentUserId: string;
}

export type ReviewMutation =
  | { action: "create"; body: string; timecode: number | null; parentId?: string | null }
  | { action: "resolve"; commentId: string; resolved: boolean }
  | { action: "delete"; commentId: string };

// Centiseconds, not frame numbers: source videos can have different frame rates.
export function formatTimecode(seconds: number): string {
  const total = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 100);
  const hours = Math.floor(total / 360000);
  const minutes = Math.floor(total / 6000) % 60;
  const remainder = Math.floor(total / 100) % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${hours ? `${pad(hours)}:` : ""}${pad(minutes)}:${pad(remainder)}.${pad(total % 100)}`;
}

export function validTimecode(value: unknown, duration: number | null): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0
    && value <= MAX_TIMECODE && (duration === null || duration <= 0 || value <= duration));
}
