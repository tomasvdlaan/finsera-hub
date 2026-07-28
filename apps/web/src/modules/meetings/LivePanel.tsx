import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { getUser } from '../../lib/auth.js';

/** Each segment is a complete, self-contained recording. See the note on start(). */
const SEGMENT_MS = 25_000;

interface Line {
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
  const [error, setError] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const loop = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Labels are hidden until permission is granted, so this list is only useful after a
    // first capture — which is why the microphone option does not depend on it.
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]));
  }, [running]);

  const stopEverything = useCallback(() => {
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
      case 'line':
        setLines((current) => [...current, message.line as Line]);
        break;
      case 'speaker':
        break; // roster changes are visible in the transcript itself
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
            <span className="muted">
              {lines.length} segment{lines.length === 1 ? '' : 's'} · {money(costCents)} so far
            </span>
            <button onClick={stop}>Stop</button>
          </div>

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
                lines.map((line, i) => (
                  <p key={i}>
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
