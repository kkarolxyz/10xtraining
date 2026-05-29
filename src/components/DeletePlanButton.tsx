import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface DeleteResponse {
  success?: boolean;
  error?: string;
}

interface Props {
  planId: string;
  redirectAfterDelete?: string;
}

export function DeletePlanButton({ planId, redirectAfterDelete }: Props) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${planId}`, { method: "DELETE" });
      if (res.ok) {
        if (redirectAfterDelete) {
          window.location.href = redirectAfterDelete;
        } else {
          ref.current?.closest("[data-plan-id]")?.remove();
        }
      } else {
        const data = (await res.json()) as DeleteResponse;
        setError(data.error ?? "Failed to delete plan — please try again");
        setIsDeleting(false);
      }
    } catch {
      setError("Failed to delete plan — please try again");
      setIsDeleting(false);
    }
  }

  return (
    <div ref={ref}>
      <Button variant="destructive" size="sm" disabled={isDeleting} onClick={handleDelete}>
        {isDeleting ? "Deleting…" : "Delete"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
