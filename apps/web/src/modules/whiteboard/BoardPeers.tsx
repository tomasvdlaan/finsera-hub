import type { Peer } from './useBoardDoc.js';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/**
 * Who else is on this board.
 *
 * Faces rather than a count, and the same hue the server derives from the user id — so the
 * avatar in the corner and the cursor moving across the canvas are recognisably one person.
 */
export function BoardPeers({
  self,
  peers,
  connected,
}: {
  self: Peer | null;
  peers: Peer[];
  connected: boolean;
}) {
  if (!connected) {
    return (
      <div className="wb-peers" title="Not connected">
        <span className="wb-peers-offline" aria-label="Offline" />
      </div>
    );
  }

  const everyone = [...(self ? [self] : []), ...peers];

  return (
    <div className="wb-peers">
      {everyone.map((peer) => (
        <span
          key={peer.clientId}
          className="wb-peer"
          style={{ background: `hsl(${peer.colour} 70% 60%)` }}
          title={peer.clientId === self?.clientId ? `${peer.name} (you)` : peer.name}
        >
          {initials(peer.name)}
        </span>
      ))}
    </div>
  );
}
