import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Empty } from '../../shell/ui/primitives.js';

/**
 * Rendered note body.
 *
 * react-markdown does not render raw HTML unless explicitly told to, and it is not told
 * to. That matters because note bodies will be model-written from Phase 6c onward, and
 * the AI plan treats anything derived from documents or transcripts as untrusted input —
 * a transcript could contain markup that a naive renderer would happily execute.
 *
 * GFM is enabled for tables and task lists, which is most of why anyone wants Markdown
 * in meeting notes at all.
 */
export function Markdown({ children }: { children: string }) {
  if (!children.trim()) return <Empty>Nothing written yet.</Empty>;
  return (
    <div className="prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
