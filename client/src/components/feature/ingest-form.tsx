import { useActionState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { ingestDiscoveredAction } from "@client/lib/actions";
import type { ActionState } from "@client/lib/action-state";
import { Submit } from "@client/components/base/submit";

export function IngestForm({ portals }: { portals: { name: string }[] }) {
  const navigate = useNavigate();
  const [state, action] = useActionState(ingestDiscoveredAction, null as ActionState);
  useEffect(() => {
    if (state?.ok && state.tenderId) navigate(`/tenders/${state.tenderId}`);
  }, [state, navigate]);
  return (
    <form action={action} className="panel form-grid">
      <h2 className="wide">Register a discovered tender</h2>
      <p className="muted wide">This opens the same Phase 1 workflow and assigns validation to Vishesh. It does not crawl the portal.</p>
      {state?.error ? (
        <p className="banner bad wide">
          {state.error} {state.tenderId ? <Link to={`/tenders/${state.tenderId}`}>Open it</Link> : null}
        </p>
      ) : null}
      <label>
        Project
        <input name="projectName" />
      </label>
      <label>
        Client
        <input name="clientName" />
      </label>
      <label>
        Portal
        <input name="portalName" list="portal-names" />
        <datalist id="portal-names">
          {portals.map((portal) => (
            <option key={portal.name} value={portal.name} />
          ))}
        </datalist>
      </label>
      <label>
        Tender reference
        <input name="tenderRef" />
      </label>
      <label>
        Tender ID
        <input name="externalTenderId" />
      </label>
      <label>
        Notice, if you already have it
        <input name="files" type="file" />
      </label>
      <div className="wide">
        <Submit>Create and assign to Vishesh</Submit>
      </div>
    </form>
  );
}
