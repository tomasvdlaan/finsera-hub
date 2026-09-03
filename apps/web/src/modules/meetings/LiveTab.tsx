import { useEffect, useState } from 'react';
import type { LiveState, Source } from '../../shell/liveMeetingReducer.js';
import { elapsedSeconds } from '../../shell/liveMeetingReducer.js';
import { Transcripts } from './Transcripts.js';

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const at = (iso: string) => new Date(iso).toTimeString().slice(0, 5);

/**
 * What the capture is doing, and the controls for it.
 *
 * The room could show a meeting but not start one — recording lived on the note page, so the
 * screen built for running a meeting was the one screen that could not begin recording it.
 *
 * It also could not say what the bot was doing. With a microphone there is nothing to say: the
 * tab either has audio or does not. A bot is a process somewhere else that has to travel to a
 * call, get admitted from a lobby, and stay there — and every one of those can fail silently
 * while the screen shows a running clock. So this reports the phase rather than a boolean.
 */
export function LiveTab({
  noteId,
  live,
  running,
  onStartBot,
  onStartCapture,
  onStop,
  onPause,
  onUnpause,
  onResumeAudio,
}: {
  noteId: string;
  live: LiveState;
  running: boolean;
  /** Consent, which the server enforces — the socket closes without it. */
  onStartBot: (meetingUrl: string) => void;
  onStartCapture: (source: 'microphone' | 'tab', deviceId?: string) => void;
  onStop: () => void;
  onPause: () => void;
  onUnpause: () => void;
  onResumeAudio: () => void;
}) {
  const [picked, setPicked] = useState<Source>('bot');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [, tick] = useState(0);

  useEffect(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]));
  }, [running]);

  /** The clock is the point of this panel, so it has to move. */
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);

  if (!running && !live.connecting) {
    return (
      <>
        <section className="room-block">
          <h3>Start recording</h3>
          <div className="row">
            <select
              value={picked}
              onChange={(e) => setPicked(e.target.value as Source)}
              aria-label="Audio source"
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="bot">Send a bot to the call</option>
              <option value="microphone">This microphone</option>
              <option value="tab">A browser tab</option>
            </select>
          </div>

          {picked === 'bot' ? (
            <>
              <div className="row">
                <input
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="Paste the meeting link"
                  aria-label="Meeting URL"
                  style={{ flex: 1, minWidth: 0 }}
                />
              </div>
              <button disabled={!meetingUrl.trim()} onClick={() => onStartBot(meetingUrl)}>
                Send the bot
              </button>
              <p className="muted">
                A named bot joins the call so everyone can see it. Each person&rsquo;s audio
                arrives separately, which is what makes &ldquo;who said what&rdquo; reliable.
                Someone may need to admit it from the lobby.
              </p>
            </>
          ) : (
            <>
              {picked === 'microphone' && devices.length > 0 && (
                <div className="row">
                  <select
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    aria-label="Input device"
                    style={{ flex: 1, minWidth: 0 }}
                  >
                    <option value="">Default input</option>
                    {devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || 'Unnamed input'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button onClick={() => onStartCapture(picked, deviceId || undefined)}>
                Start listening
              </button>
              <p className="muted">Audio is transcribed and discarded — it is never stored.</p>
            </>
          )}
        </section>

        {live.endedReason && (
          <section className="room-block">
            <h3>Last recording</h3>
            {/* The only explanation anyone gets for a meeting that stopped by itself. */}
            <p className="muted">Stopped: {live.endedReason}</p>
          </section>
        )}

        {/*
          What was said, kept beside the thing that captured it.
          
          It was only on the note page, behind a collapsed section, which is a reasonable place
          to read an hour of speech and a poor place to find it from — the question "where is
          the transcript" gets asked in the room.
        */}
        <Transcripts noteId={noteId} />
      </>
    );
  }

  return (
    <>
      <section className="room-block">
        <h3>Recording</h3>

        <div className="live-state">
          <span className={live.connecting ? 'live-dot live-dot-waiting' : 'live-dot'} />
          <strong>
            {live.connecting
              ? 'Bot on its way'
              : live.needsAudio
                ? 'No audio reaching it'
                : live.source === 'bot'
                  ? 'Bot in the call'
                  : live.source === 'tab'
                    ? 'Listening to a tab'
                    : 'Listening'}
          </strong>
          {running && <span className="room-elapsed">{clock(elapsedSeconds(live.startedAt))}</span>}
        </div>

        {live.connecting && (
          <p className="muted">
            Sent, and not in the call yet. It may be waiting in the lobby for someone to admit
            it — the clock starts when it gets in.
          </p>
        )}

        <dl className="terms live-terms">
          <dt>Source</dt>
          <dd>
            {live.source === 'bot' ? 'Meeting bot' : live.source === 'tab' ? 'Browser tab' : 'Microphone'}
          </dd>

          {live.startedAt && (
            <>
              <dt>Started</dt>
              <dd>{at(live.startedAt)}</dd>
            </>
          )}
          {/* Only a bot has these two, and only a bot can be sent without arriving. */}
          {live.joinedAt && (
            <>
              <dt>Joined the call</dt>
              <dd>{at(live.joinedAt)}</dd>
            </>
          )}

          <dt>Heard</dt>
          <dd>
            {live.lines.length} segment{live.lines.length === 1 ? '' : 's'}
          </dd>

          <dt>Cost</dt>
          <dd>{live.costCents === 0 ? 'under € 0,01' : money(live.costCents)}</dd>
        </dl>

        {live.present.length > 0 && (
          <>
            <h3>In the call</h3>
            <ul className="cards">
              {live.present.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
            <p className="muted">
              Who the bot can hear, which is not the same as who was invited — anyone here who
              has not consented is flagged under People.
            </p>
          </>
        )}

        {live.spoken.length > 0 && (
          <>
            <h3>It said</h3>
            <ul className="cards">
              {live.spoken.map((text, i) => (
                <li key={`${i}-${text.slice(0, 12)}`} className="muted">
                  {text}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="row">
          {live.needsAudio && <button onClick={onResumeAudio}>Share audio again</button>}
          {/*
            Pause, which is not a lesser Stop.

            Stopping writes the note, turns proposals into action points and cannot be undone.
            This leaves all of that where it is and can be reversed a minute later — which is
            what "give us two minutes" actually needs. Before Stop in the row because it is the
            one you reach for far more often, and because the destructive verb should not be
            the first thing under your cursor.
          */}
          {!live.paused ? (
            <button onClick={onPause}>Pause listening</button>
          ) : (
            <button onClick={onUnpause} className="room-resume">
              Resume listening
            </button>
          )}
          {/*
            Stop, without leaving.

            Distinct from End & review in the bar, which stops and then takes you to the note.
            Stopping a recording and finishing a meeting are different decisions — a bot that
            joined the wrong call needs the first and not the second.
          */}
          <button onClick={onStop} className="room-end">
            Stop recording
          </button>
        </div>
      </section>

      {live.error && <p className="error">{live.error}</p>}

      {/* Earlier recordings of this same meeting, while a new one is running. */}
      <Transcripts noteId={noteId} />
    </>
  );
}
