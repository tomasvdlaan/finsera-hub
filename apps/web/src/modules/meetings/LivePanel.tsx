import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { getUser } from '../../lib/auth.js';

/** Each segment is a complete, self-contained recording. See the note on start(). */
const SEGMENT_MS = 25_000;

interface Line {
  id: string;
  at: number;
  text: string;
  /** Present when the capture provider knows who spoke — a real name, not "Speaker 1". */
  speaker?: string;
}

interface Proposal {
  id: string;
  kind: 'action' | 'decision' | 'note' | 'agenda_covered';
  text: string;
  agendaItemId?: string;
}

interface RunningState {
  summary: string;
  decisions: string[];
  openQuestions: string[];
}

type Source = 'bot' | 'microphone' | 'tab';

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The live meeting panel.
 *
 * Audio is captured, sent, transcribed and forgotten — nothing is written to disk here or
 * on the server. What survives is the transcript text and whatever proposals you accept.
 */
export function LivePanel({
  noteId,
  canRecord,
  onFinished,
}: {
  noteId: string;
  canRecord: boolean;
  onFinished: () => void;
}) {
  const [source, setSource] = useState<Source>('bot');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [state, setState] = useState<RunningState | null>(null);
  const [costCents, setCostCents] = useState(0);
  const [chatty, setChatty] = useState(false);
  const [behaviours, setBehaviours] = useState<
    Array<{ name: string; description: string; trigger: string; canSpeak: boolean }>
  >([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [maySpeak, setMaySpeak] = useState(false);
  const [spoken, setSpoken] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const loop = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Rejoin a session that is still running.
   *
   * A refresh loses the panel's state but not the meeting — the bot is still in the call
   * and the server is still transcribing. Without this the page claims nothing is
   * happening while it demonstrably is.
   */
  useEffect(() => {
    api
      .get<{
        running: boolean;
        provider?: string;
        lines?: Line[];
        proposals?: Proposal[];
        state?: RunningState;
        costCents?: number;
      }>(`/meetings/${noteId}/live`)
      .then(async (status) => {
        if (!status.running) return;
        setSource(status.provider === 'recall' ? 'bot' : 'microphone');
        setLines(status.lines ?? []);
        setProposals(status.proposals ?? []);
        setState(status.state ?? null);
        setCostCents(status.costCents ?? 0);
        setRunning(true);
        await openSocket(); // resume the live feed
      })
      .catch(() => undefined);
    // Only on mount: reconnecting on every render would open a socket per keystroke.
  }, [noteId]);

  useEffect(() => {
    api
      .get<Array<{ name: string; description: string; trigger: string; canSpeak: boolean }>>(
        '/meetings/behaviours',
      )
      .then((all) => {
        setBehaviours(all);
        setEnabled(all.map((b) => b.name)); // matches the server's default
      })
      .catch(() => setBehaviours([]));
  }, []);

  useEffect(() => {
    // Labels are hidden until permission is granted, so this list is only useful after a
    // first capture — which is why the microphone option does not depend on it.
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]));
  }, [running]);

  const stopEverything = useCallback(() => {
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) socket.current.close();
    socket.current = null;
    if (loop.current) clearTimeout(loop.current);
    loop.current = null;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setRunning(false);
  }, []);

  useEffect(() => () => stopEverything(), [stopEverything]);

  /**
   * Record one self-contained segment, then start another.
   *
   * A single long-running recorder emits chunks that are only decodable as a continuous
   * stream — every chunk after the first lacks headers, so it cannot be transcribed on
   * its own. Stopping and restarting costs a few milliseconds at each boundary and makes
   * every segment a valid audio file.
   */
  const recordSegment = useCallback(() => {
    if (!stream.current || !socket.current) return;
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const rec = new MediaRecorder(stream.current, { mimeType });
    recorder.current = rec;
    const parts: Blob[] = [];

    rec.ondataavailable = (e) => parts.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(parts, { type: mimeType });
      if (blob.size > 1_000 && socket.current?.readyState === WebSocket.OPEN) {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8_192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8_192));
        }
        socket.current.send(
          JSON.stringify({ type: 'audio', mimeType: 'audio/webm', data: btoa(binary) }),
        );
      }
    };

    rec.start();
    loop.current = setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
      recordSegment();
    }, SEGMENT_MS);
  }, []);

  /**
   * Send a bot to the meeting, then watch.
   *
   * Unlike the browser routes this captures nothing locally — Recall joins the call and
   * streams each participant's audio to the server. The socket below is only a viewer.
   */
  const startBot = async () => {
    setError(null);
    try {
      await api.post(`/meetings/${noteId}/live/start`, { meetingUrl: meetingUrl.trim() });
      await openSocket();
      setRunning(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openSocket = async () => {
    // React StrictMode invokes mount effects twice in development, which opened two
    // sockets — and every broadcast then arrived twice, duplicating the transcript.
    // One panel is one connection regardless of how often the effect runs.
    const existing = socket.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return existing;
    }

    const user = await getUser();
    const url = new URL('/api/meetings/live', window.location.href);
    url.protocol = url.protocol.replace('http', 'ws');
    url.searchParams.set('noteId', noteId);
    url.searchParams.set('token', user?.access_token ?? '');
    const ws = new WebSocket(url);
    socket.current = ws;
    ws.onmessage = handleMessage;
    ws.onerror = () => setError('The live connection failed.');
    ws.onclose = () => stopEverything();
    return ws;
  };

  const start = async () => {
    setError(null);
    try {
      const captured =
        source === 'tab'
          ? await navigator.mediaDevices.getDisplayMedia({
              video: true, // required by the API; the video track is dropped below
              audio: { echoCancellation: false, noiseSuppression: false },
            })
          : await navigator.mediaDevices.getUserMedia({
              audio: deviceId ? { deviceId: { exact: deviceId } } : true,
            });

      if (source === 'tab') {
        captured.getVideoTracks().forEach((t) => {
          t.stop();
          captured.removeTrack(t);
        });
        if (captured.getAudioTracks().length === 0) {
          captured.getTracks().forEach((t) => t.stop());
          throw new Error(
            'That share had no audio. Re-share and tick "Share tab audio" — and note that ' +
              'macOS does not let a browser capture audio from a desktop app.',
          );
        }
      }

      stream.current = captured;

      const user = await getUser();
      const url = new URL('/api/meetings/live', window.location.href);
      url.protocol = url.protocol.replace('http', 'ws');
      url.searchParams.set('noteId', noteId);
      url.searchParams.set('token', user?.access_token ?? '');

      const ws = new WebSocket(url);
      socket.current = ws;

      ws.onmessage = (event) => handleMessage(event, true);
      ws.onerror = () => setError('The live connection failed.');
      ws.onclose = () => stopEverything();
    } catch (e) {
      stopEverything();
      setError((e as Error).message);
    }
  };

  const handleMessage = (event: MessageEvent, capturing = false) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    switch (message.type) {
      case 'ready':
        setRunning(true);
        if (capturing) recordSegment();
        break;
      case 'line': {
        const line = message.line as Line;
        setLines((current) =>
          // Belt and braces: a reconnect can replay, and a duplicated line in a client
          // meeting record is worse than a missing one.
          current.some((l) => l.id === line.id) ? current : [...current, line],
        );
        break;
      }
      case 'speaker':
        break; // roster changes are visible in the transcript itself
      case 'spoke':
        setSpoken((current) => [...current, String(message.text)]);
        break;
      case 'proposals':
        setProposals((current) => [...current, ...(message.proposals as Proposal[])]);
        break;
      case 'state':
        setState(message.state as RunningState);
        break;
      case 'cost':
        setCostCents(message.costCents as number);
        break;
      case 'stopped':
      case 'ended':
        stopEverything();
        onFinished();
        break;
      case 'error':
        setError(String(message.message));
        break;
    }
  };

  const configure = (next: { enabled?: string[]; maySpeak?: boolean }) => {
    if (next.enabled) setEnabled(next.enabled);
    if (next.maySpeak !== undefined) setMaySpeak(next.maySpeak);
    void api.post(`/meetings/${noteId}/live/behaviours`, next).catch(() => undefined);
  };

  const stop = async () => {
    if (source === 'bot') {
      // The bot is stopped server-side; it has to be told to leave the call.
      await api.post(`/meetings/${noteId}/live/stop`, {}).catch(() => undefined);
      stopEverything();
      onFinished();
      return;
    }
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify({ type: 'stop' }));
    } else {
      stopEverything();
      onFinished();
    }
  };

  if (!canRecord) {
    return (
      <p className="muted">
        Recording needs every attendee marked as having consented. Add the people who are
        in the meeting and record what each of them said.
      </p>
    );
  }

  return (
    <div>
      {!running ? (
        <>
          <div className="row">
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as Source)}
              aria-label="Audio source"
            >
              <option value="bot">Send a bot to the meeting</option>
              <option value="microphone">Microphone or virtual device</option>
              <option value="tab">A browser tab (Teams in the browser)</option>
            </select>
            {source === 'microphone' && devices.length > 0 && (
              <select
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                aria-label="Input device"
              >
                <option value="">Default input</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || 'Unnamed input'}
                  </option>
                ))}
              </select>
            )}
            {source === 'bot' ? (
              <>
                <input
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="Paste the Teams meeting link"
                  aria-label="Meeting URL"
                  style={{ flex: 1, minWidth: 260 }}
                />
                <button onClick={() => void startBot()} disabled={!meetingUrl.trim()}>
                  Send the bot
                </button>
              </>
            ) : (
              <button onClick={() => void start()}>Start listening</button>
            )}
          </div>
          <p className="muted">
            {source === 'bot'
              ? 'A named bot joins the call, so everyone can see it. Each person’s audio ' +
                'arrives separately, which is what makes “who said what” reliable. Someone ' +
                'may need to admit it from the lobby.'
              : 'Audio is transcribed and discarded — it is never stored.'}{' '}
            Nothing the assistant proposes is applied until you accept it.
          </p>
        </>
      ) : (
        <>
          <div className="row">
            <span className="badge priority-urgent">● listening</span>
            <label className="muted">
              <input
                type="checkbox"
                checked={maySpeak}
                onChange={(e) => configure({ maySpeak: e.target.checked })}
              />{' '}
              may speak aloud
            </label>
            <label className="muted">
              <input
                type="checkbox"
                checked={chatty}
                onChange={(e) => {
                  setChatty(e.target.checked);
                  void api.post(`/meetings/${noteId}/live/chatty`, { on: e.target.checked });
                }}
              />{' '}
              chatty (testing)
            </label>
            <span className="muted">
              {lines.length} segment{lines.length === 1 ? '' : 's'} · {money(costCents)} so far
            </span>
            <button onClick={stop}>Stop</button>
          </div>

          {behaviours.length > 0 && (
            <section>
              <h3>What it is doing</h3>
              <ul className="agenda">
                {behaviours.map((b) => (
                  <li key={b.name}>
                    <label>
                      <input
                        type="checkbox"
                        checked={enabled.includes(b.name)}
                        onChange={(e) =>
                          configure({
                            enabled: e.target.checked
                              ? [...enabled, b.name]
                              : enabled.filter((n) => n !== b.name),
                          })
                        }
                      />{' '}
                      <strong>{b.name.replace(/_/g, ' ')}</strong>{' '}
                      <span className="muted">{b.description}</span>
                    </label>
                    {b.canSpeak && !maySpeak && <span className="badge">silent</span>}
                  </li>
                ))}
              </ul>
              <p className="muted">
                Behaviours propose quietly by default. Nothing they suggest is applied
                until you accept it, and none of them speaks unless you allow it above.
              </p>
            </section>
          )}

          {chatty && (
            <p className="muted">
              The bot will speak in the meeting. It waits at least 8 seconds between
              replies and chooses silence when it has nothing useful to add.
              {spoken.length > 0 && ` It has spoken ${spoken.length} time${spoken.length === 1 ? '' : 's'}.`}
            </p>
          )}

          {state?.summary && (
            <section>
              <h3>So far</h3>
              <p>{state.summary}</p>
              {state.openQuestions.length > 0 && (
                <>
                  <h3>Open questions</h3>
                  <ul className="cards">
                    {state.openQuestions.map((q) => (
                      <li key={q} className="muted">
                        {q}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {proposals.length > 0 && (
            <section>
              <h3>Suggested</h3>
              <ul className="cards">
                {proposals.map((p) => (
                  <li key={p.id}>
                    <span className="badge">{p.kind.replace('_', ' ')}</span> {p.text}
                  </li>
                ))}
              </ul>
              <p className="muted">
                These are recorded on the note when you stop, still needing your decision.
              </p>
            </section>
          )}

          <section>
            <h3>Transcript</h3>
            <div className="transcript">
              {lines.length === 0 ? (
                <p className="muted">Listening…</p>
              ) : (
                lines.map((line) => (
                  <p key={line.id}>
                    <span className="muted">{clock(line.at)}</span>{' '}
                    {line.speaker && <strong>{line.speaker}: </strong>}
                    {line.text}
                  </p>
                ))
              )}
            </div>
          </section>
        </>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
