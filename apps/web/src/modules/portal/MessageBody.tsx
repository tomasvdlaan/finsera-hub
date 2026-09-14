import { Fragment, type ReactNode } from 'react';
import { parseMessage, type Block, type Inline } from '@platform/ticket-markdown';

/**
 * A ticket message, with the small amount of formatting it is allowed to carry.
 *
 * The twin of the portal's component, and the more important of the two: this renders text
 * **a client wrote** inside the internal application, where the reader holds an admin
 * session. Client-authored HTML rendered here would be an XSS with the whole platform
 * behind it, which is exactly why the parser returns a tree of nodes with string leaves
 * rather than an HTML string — every leaf goes through React's escaping, and there is no
 * `dangerouslySetInnerHTML` in the path.
 *
 * The mapping is duplicated rather than shared because it contains no rules: which markers
 * exist and which link schemes are clickable live in `@platform/ticket-markdown`, which
 * both apps import. Sharing the component would mean a package that depends on React.
 */
export function MessageBody({ source }: { source: string }) {
  return <>{parseMessage(source).map((block, i) => renderBlock(block, i))}</>;
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'paragraph':
      // `pre-wrap` because a single newline stays a line break: that is what the messages
      // written before formatting existed relied on, and what a chat box does everywhere.
      return (
        <p key={key} style={{ whiteSpace: 'pre-wrap' }}>
          {renderInline(block.children)}
        </p>
      );
    case 'bullets':
      return (
        <ul key={key}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'numbers':
      return (
        <ol key={key} start={block.start}>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ol>
      );
  }
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.value}</Fragment>;
      case 'code':
        return <code key={i}>{node.value}</code>;
      case 'strong':
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>;
      case 'link':
        return (
          // `noreferrer` as well as `noopener`: a link in a client's own message should not
          // tell whoever it points at which portal page it was written on.
          <a key={i} href={node.href} target="_blank" rel="noopener noreferrer">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}
