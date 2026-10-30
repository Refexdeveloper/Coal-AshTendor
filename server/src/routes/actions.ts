import { Router, type Request } from "express";
import multer from "multer";
import * as actions from "../services/actions";
import type { Action } from "../services/actions";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

/** Endpoint name → action. The client posts its form to /api/actions/<name>. */
const ACTIONS: Record<string, Action> = {
  "create-tender": actions.createTenderAction,
  "create-sample": actions.createSampleAction,
  "update-fields": actions.updateFieldsAction,
  task: actions.taskAction,
  "save-calendar": actions.saveCalendarAction,
  "add-holiday": actions.addHolidayAction,
  "add-user": actions.addUserAction,
  "update-user-access": actions.updateUserAccessAction,
  "sync-refexone-users": actions.syncRefexOneUsersAction,
  "delete-holiday": actions.deleteHolidayAction,
  "delete-tender": actions.deleteTenderAction,
  "clear-tenders": actions.clearTendersAction,
  "save-sla": actions.saveSlaAction,
  "save-settings": actions.saveSettingsAction,
  "save-template": actions.saveTemplateAction,
  "save-portal": actions.savePortalAction,
  "toggle-portal": actions.togglePortalAction,
  "log-exception": actions.logExceptionAction,
  "ingest-discovered": actions.ingestDiscoveredAction,
};

/** Rebuilds the browser's FormData so the actions read fields and files exactly as they did before. */
function formDataOf(req: Request) {
  const form = new FormData();
  for (const [key, value] of Object.entries(req.body ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, String(item));
  }
  for (const file of (req.files as Express.Multer.File[] | undefined) ?? []) {
    form.append(file.fieldname, new File([new Uint8Array(file.buffer)], Buffer.from(file.originalname, "latin1").toString("utf8"), { type: file.mimetype }));
  }
  return form;
}

export const actionRoutes = Router();

actionRoutes.post("/:name", upload.any(), async (req, res) => {
  const action = ACTIONS[req.params.name as string];
  if (!action) {
    res.status(404).json({ error: "Unknown action." });
    return;
  }
  try {
    res.json((await action(req.actor!, formDataOf(req))) ?? null);
  } catch (error) {
    console.error(error);
    const message = error instanceof Error && error.message ? error.message : "The action could not be completed.";
    res.status(500).json({ error: message });
  }
});
