import type { ActionState } from "./action-state";
import { apiPost, postAction } from "./api";

/** Client-side stand-ins for the old server actions: same (state, formData) shape, so useActionState works unchanged. */
const bound = (name: string) => (_state: ActionState, formData: FormData) => postAction(name, formData);

export const createTenderAction = bound("create-tender");
export const createSampleAction = bound("create-sample");
export const updateFieldsAction = bound("update-fields");
export const taskAction = bound("task");
export const ingestDiscoveredAction = bound("ingest-discovered");

export async function loginAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    return await apiPost<ActionState>("/auth/login", formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sign-in failed." };
  }
}

export async function logoutAction() {
  await apiPost("/auth/logout").catch(() => null);
  window.location.assign("/login");
}
