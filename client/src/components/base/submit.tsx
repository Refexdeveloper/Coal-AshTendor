import { useFormStatus } from "react-dom";

export function Submit({
  children,
  variant = "primary",
  name,
  value,
}: {
  children: React.ReactNode;
  variant?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={`btn ${variant}`} name={name} value={value} disabled={pending}>
      {pending ? "Saving…" : children}
    </button>
  );
}
