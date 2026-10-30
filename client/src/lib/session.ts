import { createContext, useContext } from "react";
import type { PublicUser } from "./types";

export type Session = { user: PublicUser; openTasks: number };

export const SessionContext = createContext<Session | null>(null);

/** The signed-in user. Only used under MainLayout, which loads the session before rendering pages. */
export function useActor() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useActor must be used inside MainLayout");
  return session.user;
}
