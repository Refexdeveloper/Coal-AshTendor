/** Copy of server/src/utils/action-state.ts (no server dependencies). Keep the two in step. */
export type ActionState = {
  error?: string;
  ok?: string;
  tenderId?: string;
  /** Raw API token, returned once on create. Store it; it is not shown again. */
  apiToken?: string;
  exchange?: { method: string; url: string; status: number; request: string; response: string };
} | null;