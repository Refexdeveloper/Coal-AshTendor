import { useActor } from "@client/api/session";
import { CREATOR_ROLES } from "@client/lib/labels";
import { CreateForm } from "@client/components/feature/create-form";

const STEPS = [
  ["Drop the notice", "Choose the PDF or scan. Nothing else to type."],
  ["We read it", "The uploaded file is sent to OCR. Returned fields are placed on the tender form."],
  ["You verify", "Check what was read, fix anything highlighted, and send it for review in one click."],
  ["Review", "Vishesh and Ranjana are emailed. Either one approves or rejects within 24 working hours."],
];

export default function NewTenderPage() {
  const actor = useActor();
  if (!CREATOR_ROLES.includes(actor.role)) {
    return <p className="panel">Your role cannot register tenders. Ask the Tender Coordinator to upload it.</p>;
  }
  return (
    <>
      <header className="page-head">
        <div>
          <h1>New tender</h1>
          <p>Drop the tender notice and the system reads it for you. If it matches a tender that is already open, you are told instead of a second workflow being started.</p>
        </div>
      </header>
      <ol className="how">
        {STEPS.map(([title, body], index) => (
          <li key={title}>
            <span className="how-n">{index + 1}</span>
            <strong>{title}</strong>
            <p>{body}</p>
          </li>
        ))}
      </ol>
      <CreateForm />
    </>
  );
}
