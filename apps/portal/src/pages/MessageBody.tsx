import { Fragment, type ReactNode } from 'react';
import { parseMessage, type Block, type Inline } from '@platform/ticket-markdown';

/**
 * A ticket message, with the small amount of formatting it is allowed to carry.
 *
 * The parser hands back a tree of nodes with string leaves and this maps them to elements,
 * so every piece of text a person wrote goes through React's own escaping. There is no HTML
 * string in the path and nothing to sanitise — a client who types `<script>` sees the
 * characters they typed.
 *
 * This mapping is duplicated in hub rather than shared, and that is the right side of the
 * trade: it is thirty lines of `switch` with no rules in it, while everything that decides
 * what is *allowed* — which markers exist, which link schemes are clickable — lives in the
 * one package both apps import. Sharing the component instead would mean a package that
 * depends on React and carries JSX into a bundle a client downloads.
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
