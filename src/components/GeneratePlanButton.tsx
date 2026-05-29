import { useEffect, useState } from "react";
import { GeneratePlanForm } from "@/components/GeneratePlanForm";

interface Props {
  label?: string;
  disabled?: boolean;
  className?: string;
  initialRideStats?: string;
  initialGoal?: "speed" | "distance" | "";
  updatePlanId?: string;
}

export function GeneratePlanButton({
  label = "Generate plan",
  disabled = false,
  className,
  initialRideStats,
  initialGoal,
  updatePlanId,
}: Props) {
  const [isOpen, setIsOpen] = useState(false);

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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
        }}
        className={`rounded-lg bg-purple-600 px-6 py-3 text-sm font-semibold transition-colors hover:bg-purple-500${className ? ` ${className}` : ""}`}
      >
        {label}
      </button>

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
              <h2 className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-2xl font-bold text-transparent">
                Generate Plan
              </h2>
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
            <GeneratePlanForm
              disabled={disabled}
              initialRideStats={initialRideStats}
              initialGoal={initialGoal}
              updatePlanId={updatePlanId}
            />
          </div>
        </div>
      )}
    </>
  );
}
