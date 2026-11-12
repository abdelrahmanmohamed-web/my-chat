import { useMemo } from "react";
import { parseMessageSegments } from "../chat.utils";

interface MessageContentProps {
  content: string;
}

export function MessageContent({ content }: MessageContentProps) {
  const segments = useMemo(() => parseMessageSegments(content), [content]);

  return (
    <p className="m-0 text-sm leading-relaxed wrap-break-word whitespace-pre-wrap">
      {segments.map((segment, index) => {
        if (segment.type === "link") {
          return (
            <a
              key={`${index}-${segment.href}`}
              href={segment.href}
              target="_blank"
              rel="noopener noreferrer"
              dir="ltr"
              className="inline-block underline decoration-current/60 underline-offset-2 hover:opacity-80"
            >
              {segment.value}
            </a>
          );
        }

        return <span key={index}>{segment.value}</span>;
      })}
    </p>
  );
}
