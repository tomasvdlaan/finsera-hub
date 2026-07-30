import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../lib/api.js';
import { getUser } from '../lib/auth.js';
import {
  EMPTY,
  liveReducer,
  type LiveState,
  type LiveStatus,
} from './liveMeetingReducer.js';

/** Each segment is a complete, self-contained recording. See the note on recordSegment. */
const SEGMENT_MS = 25_000;

export interface Behaviour {
  name: string;
  description: string;
  trigger: string;
  canSpeak: boolean;
}

interface LiveMeeting {
  live: LiveState;
  behaviours: Behaviour[];
  enabled: string[];
  maySpeak: boolean;
  chatty: boolean;
  /**
   * Pick a running session back up, and start feeding it again if nothing else is.
   *
   * Covers both halves of a reload: the server holds a meeting open for a moment after its
   * audio source disappears, and this reconnects into that window. A microphone resumes
   * silently; a shared tab sets `needsAudio`, because it cannot be reacquired without a
   * gesture, and then `resumeAudio` is what the button calls.
   */
  resume: (noteId: string) => Promise<void>;
  resumeAudio: (
    noteId: string,
    source: 'microphone' | 'tab',
    deviceId?: string,
  ) => Promise<void>;
  startBot: (noteId: string, meetingUrl: string) => Promise<void>;
  startCapture: (noteId: string, source: 'microphone' | 'tab', deviceId?: string) => Promise<void>;
  stop: () => Promise<void>;
  configure: (next: { enabled?: string[]; maySpeak?: boolean }) => void;
  setChatty: (on: boolean) => void;
}

const Context = createContext<LiveMeeting | null>(null);

/**
 * The running meeting, owned by the shell rather than by a page.
 *
 * It lives here because of a defect this fixes rather than a preference. The panel used to
 * own the socket and closed it on unmount — and the server treats a closed socket from the
 * audio source as the end of the meeting: `handleDisconnect` calls `finish()`, which writes
 * the body, turns proposals into action points, saves the transcript and deregisters the
 * session. So navigating away from the note during a microphone recording **ended and
 * finalised the meeting**. Clicking a link cost you the rest of the call.
 *
 * It was asymmetric, which is why it went unnoticed. With a bot the browser is only a
 * registered watcher, so its socket closing means nothing; with browser capture the tab *is*
 * the microphone. One of the two paths quietly destroyed meetings and the other did not.
 *
 * Mounted above both layouts, so the session survives every route change, and so a room and
 * the note page are two views of one meeting rather than two meetings.
 *
 * Nothing here writes audio anywhere. Segments are captured, sent, transcribed and dropped;
 * what survives is text.
 */
export function LiveMeetingProvider({ children }: { children: ReactNode }) {
  const [live, dispatch] = useReducer(liveReducer, EMPTY);
  const [behaviours, setBehaviours] = useState<Behaviour[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [maySpeak, setMaySpeak] = useState(false);
  const [chatty, setChattyState] = useState(false);

  const socket = useRef<WebSocket | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const loop = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether this tab is the audio source, as opposed to a watcher of a bot session. */
  const capturing = useRef(false);
  /** Guards the resume effect against StrictMode's double invocation. */
  const resuming = useRef<string | null>(null);

  useEffect(() => {
    api
      .get<Behaviour[]>('/meetings/behaviours')
      .then((all) => {
        setBehaviours(all);
        setEnabled(all.map((b) => b.name)); // matches the server's default
      })
      .catch(() => setBehaviours([]));
  }, []);

  /**
   * Release local capture without telling the server anything.
   *
   * Deliberately not called on unmount — that is the whole point of this component. It runs
   * when a meeting has genuinely finished, so the microphone light goes out.
   */
  const releaseLocal = useCallback(() => {
    if (loop.current) clearTimeout(loop.current);
    loop.current = null;
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    recorder.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    capturing.current = false;
  }, []);

  /**
   * Record one self-contained segment, then start another.
   *
   * A single long-running recorder emits chunks that are only decodable as a continuous
   * stream — every chunk after the first lacks headers, so it cannot be transcribed on its
   * own. Stopping and restarting costs a few milliseconds at each boundary and makes every
   * segment a valid audio file.
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

  const openSocket = useCallback(
    async (noteId: string, source?: 'microphone' | 'tab') => {
      // StrictMode invokes mount effects twice in development, which opened two sockets —
      // and every broadcast then arrived twice, duplicating the transcript. One provider is
      // one connection however often this runs.
      const existing = socket.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)
      ) {
        return existing;
      }

      const user = await getUser();
      const url = new URL('/api/meetings/live', window.location.href);
      url.protocol = url.protocol.replace('http', 'ws');
      url.searchParams.set('noteId', noteId);
      url.searchParams.set('token', user?.access_token ?? '');
      // Told to the server so it can say, on reconnect, whether the audio can be picked back
      // up without asking — a microphone can, a shared tab cannot.
      if (source) url.searchParams.set('source', source);

      const ws = new WebSocket(url);
      socket.current = ws;
      ws.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        dispatch({ type: 'message', message });
        // The server only accepts audio once it has said it is ready, and only this tab
        // knows whether it is the source.
        if (message.type === 'ready' && capturing.current) recordSegment();
        if (message.type === 'stopped' || message.type === 'ended') releaseLocal();
      };
      ws.onerror = () => dispatch({ type: 'failed', message: 'The live connection failed.' });
      ws.onclose = () => {
        socket.current = null;
        releaseLocal();
        dispatch({ type: 'closed' });
      };
      return ws;
    },
    [recordSegment, releaseLocal],
  );

  /** Get hold of some audio. Shared by starting a meeting and by taking one back over. */
  const acquire = useCallback(async (source: 'microphone' | 'tab', deviceId?: string) => {
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
    return captured;
  }, []);

  const resume = useCallback(
    async (noteId: string) => {
      if (live.noteId === noteId && live.running) return;
      if (resuming.current === noteId) return;
      resuming.current = noteId;
      try {
        const status = await api.get<LiveStatus>(`/meetings/${noteId}/live`);
        if (!status.running) return;
        dispatch({ type: 'resumed', noteId, status });

        /*
         * A meeting running with nobody feeding it is this tab, a moment ago, before it
         * reloaded. Take it back over.
         *
         * A microphone is reacquired without asking: browsers remember that permission per
         * origin, so getUserMedia resolves silently and the recording simply continues. A
         * shared tab cannot be — getDisplayMedia always needs a fresh gesture and a picker, by
         * design — so that case asks, via needsAudio.
         */
        if (status.awaitingAudio && status.source === 'microphone') {
          try {
            stream.current = await acquire('microphone');
            capturing.current = true;
            dispatch({ type: 'audioOk' });
          } catch {
            // Permission was revoked, or another tab holds the device.
            capturing.current = false;
            dispatch({ type: 'needsAudio' });
          }
        } else if (status.awaitingAudio) {
          capturing.current = false;
          dispatch({ type: 'needsAudio' });
        } else {
          capturing.current = false; // already being fed from elsewhere — a bot, or another tab
        }

        await openSocket(noteId, status.source === 'tab' ? 'tab' : 'microphone');
      } catch {
        /* Nothing running, or the note is gone. Either way there is nothing to resume. */
      } finally {
        resuming.current = null;
      }
    },
    [acquire, live.noteId, live.running, openSocket],
  );

  const startBot = useCallback(
    async (noteId: string, meetingUrl: string) => {
      dispatch({ type: 'starting', noteId, source: 'bot' });
      try {
        await api.post(`/meetings/${noteId}/live/start`, { meetingUrl: meetingUrl.trim() });
        capturing.current = false; // Recall streams the audio; this socket only watches
        await openSocket(noteId);
      } catch (e) {
        dispatch({ type: 'failed', message: (e as Error).message });
      }
    },
    [openSocket],
  );

  const startCapture = useCallback(
    async (noteId: string, source: 'microphone' | 'tab', deviceId?: string) => {
      dispatch({ type: 'starting', noteId, source });
      try {
        stream.current = await acquire(source, deviceId);
        capturing.current = true;
        dispatch({ type: 'audioOk' });
        await openSocket(noteId, source);
      } catch (e) {
        releaseLocal();
        dispatch({ type: 'failed', message: (e as Error).message });
      }
    },
    [acquire, openSocket, releaseLocal],
  );

  /**
   * Start feeding a meeting that is running but has nobody sending it audio.
   *
   * The other half of surviving a reload. `resume` handles a microphone on its own, because
   * browsers remember that permission per origin; a shared tab cannot be reacquired without a
   * gesture, so this is what the button calls. It does not reset the session — the lines and
   * proposals already gathered are the meeting.
   */
  const resumeAudio = useCallback(
    async (noteId: string, source: 'microphone' | 'tab', deviceId?: string) => {
      try {
        stream.current = await acquire(source, deviceId);
        capturing.current = true;
        dispatch({ type: 'audioOk' });
        await openSocket(noteId, source);
      } catch (e) {
        // Still unfed, and still saying so — this is the button that failed, so the state it
        // was offered to fix has to survive the failure.
        releaseLocal();
        dispatch({ type: 'needsAudio' });
        dispatch({ type: 'failed', message: (e as Error).message });
      }
    },
    [acquire, openSocket, releaseLocal],
  );

  const stop = useCallback(async () => {
    const noteId = live.noteId;
    if (!noteId) return;

    if (live.source === 'bot') {
      // The bot is stopped server-side; it has to be told to leave the call.
      await api.post(`/meetings/${noteId}/live/stop`, {}).catch(() => undefined);
      socket.current?.close();
      releaseLocal();
      dispatch({ type: 'closed' });
      return;
    }

    if (socket.current?.readyState === WebSocket.OPEN) {
      // Asking the server to stop, rather than just closing: it replies with 'stopped' once
      // the note is written, which is the signal a consumer needs to refetch.
      socket.current.send(JSON.stringify({ type: 'stop' }));
    } else {
      releaseLocal();
      dispatch({ type: 'closed' });
    }
  }, [live.noteId, live.source, releaseLocal]);

  /*
   * Behaviour settings are per meeting, so they are addressed by note id — read from a ref
   * rather than from state, because these callbacks are handed to a checkbox that outlives
   * several renders and a closure over live.noteId would go stale the moment a session
   * starts or ends.
   */
  const noteIdRef = useRef<string | null>(null);
  noteIdRef.current = live.noteId;

  const configure = useCallback((next: { enabled?: string[]; maySpeak?: boolean }) => {
    if (next.enabled) setEnabled(next.enabled);
    if (next.maySpeak !== undefined) setMaySpeak(next.maySpeak);
    const noteId = noteIdRef.current;
    if (noteId) void api.post(`/meetings/${noteId}/live/behaviours`, next).catch(() => undefined);
  }, []);

  const setChatty = useCallback((on: boolean) => {
    setChattyState(on);
    const noteId = noteIdRef.current;
    if (noteId) void api.post(`/meetings/${noteId}/live/chatty`, { on }).catch(() => undefined);
  }, []);

  return (
    <Context.Provider
      value={{
        live,
        behaviours,
        enabled,
        maySpeak,
        chatty,
        resume,
        resumeAudio,
        startBot,
        startCapture,
        stop,
        configure,
        setChatty,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useLiveMeeting(): LiveMeeting {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('useLiveMeeting must be used inside LiveMeetingProvider');
  return ctx;
}
