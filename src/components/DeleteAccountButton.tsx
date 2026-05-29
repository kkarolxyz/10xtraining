import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

export function DeleteAccountButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  async function handleDelete() {
    setIsDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "DELETE" });
      if (res.ok) {
        window.location.href = "/?deleted=1";
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? "Failed to delete account — please try again");
        setIsDeleting(false);
      }
    } catch {
      setError("Failed to delete account — please try again");
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Button
        variant="destructive"
        onClick={() => {
          setIsOpen(true);
        }}
      >
        Delete Account
      </Button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24"
          onClick={() => {
            setIsOpen(false);
          }}
        >
          <div
            className="relative w-full max-w-xl overflow-y-auto rounded-2xl border border-white/10 bg-gray-900 p-8"
            style={{ maxHeight: "75vh" }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-red-400">Delete Account</h2>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                }}
                className="text-xl leading-none text-blue-100/50 hover:text-white"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <p className="mb-6 text-sm text-white/70">
              This will permanently delete your account and all training plans. This action cannot be undone.
            </p>

            <div className="mb-6">
              <label htmlFor="confirm-delete" className="mb-2 block text-sm font-medium text-white/70">
                Type <span className="font-mono font-bold text-white">DELETE</span> to confirm
              </label>
              <input
                id="confirm-delete"
                type="text"
                value={confirmText}
                onChange={(e) => {
                  setConfirmText(e.target.value);
                }}
                className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-white placeholder-white/30 focus:border-red-500/50 focus:outline-none"
                placeholder="DELETE"
              />
            </div>

            <div className="flex gap-3">
              <Button
                variant="destructive"
                disabled={confirmText.trim() !== "DELETE" || isDeleting}
                onClick={handleDelete}
              >
                {isDeleting ? "Deleting…" : "Confirm"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setIsOpen(false);
                }}
              >
                Cancel
              </Button>
            </div>

            {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
          </div>
        </div>
      )}
    </>
  );
}
