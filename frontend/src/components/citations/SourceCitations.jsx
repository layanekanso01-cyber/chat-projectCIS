import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function SourceCitations({ sources }) {
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-gray-200 pt-2">
      <span className="text-[10px] font-medium tracking-wide text-gray-400 uppercase">
        Sources
      </span>
      {sources.map((source, index) => (
        <Tooltip key={`${source.source}-${source.chunk_id}-${index}`}>
          <TooltipTrigger className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[10px] font-medium text-gray-700 outline-none transition-colors hover:bg-gray-300 focus-visible:ring-2 focus-visible:ring-blue-400">
            {index + 1}
          </TooltipTrigger>
          <TooltipContent>
            <div className="max-w-[220px]">
              <p className="truncate">{source.source}</p>
              <p className="text-background/70">Chunk {source.chunk_id}</p>
            </div>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
