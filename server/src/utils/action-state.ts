export type ActionState = {
  error?: string;
  ok?: string;
  tenderId?: string;
  exchange?: { method: string; url: string; status: number; request: string; response: string };
} | null;
