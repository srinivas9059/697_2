// src/components/LLMOptions.tsx
import { RefreshCw, Sliders, Wrench, X } from "lucide-react";

export function LLMOptions({
  onShowMore,
  onPrefs,
  onTools,
  onDone,
}: {
  onShowMore: () => void;
  onPrefs: () => void;
  onTools: () => void;
  onDone: () => void;
}) {
  const baseBtn =
    "flex items-center space-x-2 px-4 py-1.5 rounded-2xl transition hover:brightness-90";

  return (
    <div className="flex flex-wrap gap-3 mt-4">
      <button
        onClick={onShowMore}
        className={`${baseBtn} border border-gray-500 text-white`}
      >
        <RefreshCw className="h-4 w-4" />
        <span>Show More LLMs</span>
      </button>

      <button
        onClick={onPrefs}
        className={`${baseBtn} bg-indigo-600 text-white`}
      >
        <Sliders className="h-4 w-4" />
        <span>I Have Preferences</span>
      </button>

      <button
        onClick={onTools}
        className={`${baseBtn} border border-gray-500 text-white`}
      >
        <Wrench className="h-4 w-4" />
        <span>Related Tools</span>
      </button>

      <button onClick={onDone} className={`${baseBtn} text-red-400`}>
        <X className="h-4 w-4" />
        <span>Done</span>
      </button>
    </div>
  );
}
