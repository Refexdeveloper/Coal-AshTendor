import type { ActionState } from "./action-state";
import { apiPost, postAction } from "./client";

/** Client-side stand-ins for the old server actions: same (state, formData) shape, so useActionState works unchanged. */
const bound = (name: string) => (_state: ActionState, formData: FormData) => postAction(name, formData);

export const createTenderAction = bound("create-tender");
export const createSampleAction = bound("create-sample");
export const updateFieldsAction = bound("update-fields");
export const taskAction = bound("task");
export const importBondsAction = bound("import-bonds");
export const importGuaranteesAction = bound("import-guarantees");
export const addGuaranteeAction = bound("add-guarantee");
export const updateEmdRegisterAction = bound("update-emd");
export const convertEmdToSdAction = bound("convert-emd-sd");
export const updateGuaranteeAction = bound("update-guarantee");
export const ingestDiscoveredAction = bound("ingest-discovered");

export async function loginAction(_state: ActionState, formData: FormData): Promise<ActionState> {
  try {
    return await apiPost<ActionState>("/auth/login", formData);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Sign-in failed." };
  }
}

/** Signs out of Coal & Ash and goes back to Refex One, as the P2P app does. The admin sign-in page stays local. */
export async function logoutAction() {
  await apiPost("/auth/logout").catch(() => null);
  if (window.location.pathname.startsWith("/admin")) window.location.assign("/admin/login");
  else window.location.replace("https://refexone.com");
}
