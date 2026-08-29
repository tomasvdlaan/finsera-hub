import { useEffect, useRef, useState } from 'react';
import {
  EAGERNESS_LEVELS,
  useLiveMeeting,
  type Eagerness,
  type EagernessDial,
  type EagernessLevel,
} from '../../shell/LiveMeeting.js';
import type { Source } from '../../shell/liveMeetingReducer.js';

const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * What each dial governs, in the operator's terms.
 *
 * Three controls rather than one slider, because the three things the agent does cost
 * different amounts when it is wrong — writing in a note you can delete, putting work on
 * somebody's list, and interrupting a room with a client in it are not one preference.
 */
const DIALS: Array<{ dial: EagernessDial; label: string; hint: string }> = [
  {
    dial: 'notes',
    label: 'Writing in the note',
    hint: 'How much it records, and how readily it edits what is already there.',
  },
  {
    dial: 'actions',
    label: 'Suggesting work',
    hint: 'How sure it must be before proposing an action point or a decision.',
  },
  {
    dial: 'speech',
    label: 'Speaking up',
    hint: 'How readily it interrupts. Only applies when it may speak at all.',
  },
];

/** What a level means, said plainly. The words on the dial are not self-explanatory. */
const LEVEL_HINTS: Record<EagernessDial, Record<EagernessLevel, string>> = {
  notes: {
    reserved: 'Only decisions, figures and commitments.',
    balanced: 'What a reader would need next week.',
    eager: 'Generously — easier to delete than to remember.',
  },
  actions: {
    reserved: 'Only what somebody said in as many words.',
    balanced: 'What the room clearly agreed.',
    eager: 'Anything that sounds like work taken on.',
  },
  speech: {
    reserved: 'Almost never.',
    balanced: 'When the room needs it now.',
    eager: 'Whenever it can usefully add.',
  },
};

/**
 * One dial.
 *
 * Radio buttons rather than a range input: three named positions with meanings are not a
 * continuum, and a slider would imply a precision the setting does not have.
 */
function Dial({
  dial,
  label,
  hint,
  level,
  disabled,
  onChange,
}: {
  dial: EagernessDial;
  label: string;
  hint: string;
  level: EagernessLevel;
  disabled?: boolean;
  onChange: (next: EagernessLevel) => void;
}) {
  return (
    <li>
      <strong>{label}</strong> <span className="muted">{hint}</span>
      <div className="row">
        {EAGERNESS_LEVELS.map((option) => (
          <label key={option} className={option === level ? undefined : 'muted'}>
            <input
              type="radio"
              name={`eagerness-${dial}`}
              checked={option === level}
              disabled={disabled}
              onChange={() => onChange(option)}
            />{' '}
            {option}
          </label>
        ))}
      </div>
      <p className="muted">{LEVEL_HINTS[dial][level]}</p>
    </li>
  );
}

/**
 * The live meeting panel.
 *
 * A view of the session, not its owner. The socket, the recorder and everything the meeting
 * has produced live in LiveMeetingProvider above the router — because this component
 * unmounts when you navigate, and closing the socket from the audio source is how the server
 * is told the meeting is over. See the docblock there; it cost a meeting to find out.
 *
 * What is left here is the picker, the local device list and the rendering.
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
  const {
    live,
    behaviours,
    enabled,
    maySpeak,
    eagerness,
    chatty,
    resume,
    loadSettings,
    resumeAudio,
    startBot,
    startCapture,
    stop,
    configure,
    setChatty,
  } = useLiveMeeting();

  const [picked, setPicked] = useState<Source>('bot');
  const [meetingUrl, setMeetingUrl] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');

  /** This note's session, not somebody else's — a meeting elsewhere is not this panel's. */
  const running = live.running && live.noteId === noteId;

  useEffect(() => {
    void resume(noteId);
    // Only on mount for this note: resuming on every render would reopen the socket.
  }, [noteId, resume]);

  useEffect(() => {
    // The note's own settings, not the platform defaults the provider starts with. Separate
    // from `resume` because these exist whether or not anything is recording.
    void loadSettings(noteId);
  }, [noteId, loadSettings]);

  useEffect(() => {
    // Labels are hidden until permission is granted, so this list is only useful after a
    // first capture — which is why the microphone option does not depend on it.
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((all) => setDevices(all.filter((d) => d.kind === 'audioinput')))
      .catch(() => setDevices([]));
  }, [running]);

  /*
   * Refetch the note when the meeting says it is behind.
   *
   * The provider bumps a counter instead of calling back, so it can stay a pure reducer.
   * The first value is skipped: a counter starting at 0 would otherwise refetch on mount for
   * every note, including ones with no meeting at all.
   */
  const seen = useRef(live.noteStaleAt);
  useEffect(() => {
    if (live.noteStaleAt === seen.current) return;
    seen.current = live.noteStaleAt;
    onFinished();
  }, [live.noteStaleAt, onFinished]);

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
              value={picked}
              onChange={(e) => setPicked(e.target.value as Source)}
              aria-label="Audio source"
            >
              <option value="bot">Send a bot to the meeting</option>
              <option value="microphone">Microphone or virtual device</option>
              <option value="tab">A browser tab (Teams in the browser)</option>
            </select>
            {picked === 'microphone' && devices.length > 0 && (
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
            {picked === 'bot' ? (
              <>
                <input
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="Paste the Teams meeting link"
                  aria-label="Meeting URL"
                  style={{ flex: 1, minWidth: 260 }}
                />
                <button
                  onClick={() => void startBot(noteId, meetingUrl)}
                  disabled={!meetingUrl.trim()}
                >
                  Send the bot
                </button>
              </>
            ) : (
              <button onClick={() => void startCapture(noteId, picked, deviceId || undefined)}>
                Start listening
              </button>
            )}
          </div>
          <p className="muted">
            {picked === 'bot'
              ? 'A named bot joins the call, so everyone can see it. Each person’s audio ' +
                'arrives separately, which is what makes “who said what” reliable. Someone ' +
                'may need to admit it from the lobby.'
              : 'Audio is transcribed and discarded — it is never stored.'}{' '}
            Nothing the assistant proposes is applied until you accept it.
          </p>
        </>
      ) : (
        <>
          {/*
            Running, but nothing is feeding it.
            
            A shared tab cannot be reacquired without a gesture — getDisplayMedia always asks —
            so after a reload this is the one case the meeting cannot heal on its own. Shown
            rather than silently letting the grace window expire.
          */}
          {live.needsAudio && (
            <div className="row">
              <span className="tag overdue">no audio reaching the meeting</span>
              <button onClick={() => void resumeAudio(noteId, live.source === 'tab' ? 'tab' : 'microphone', deviceId || undefined)}>
                Share {live.source === 'tab' ? 'the tab' : 'the microphone'} again
              </button>
            </div>
          )}

          <div className="row">
            <span className="badge priority-urgent">
              {live.needsAudio ? '● paused' : '● listening'}
            </span>
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
                onChange={(e) => setChatty(e.target.checked)}
              />{' '}
              chatty (testing)
            </label>
            <span className="muted">
              {live.lines.length} segment{live.lines.length === 1 ? '' : 's'} ·{' '}
              {money(live.costCents)} so far
            </span>
            <button onClick={() => void stop()}>Stop</button>
          </div>

          {/*
            Shown for every audio source, which is now true.

            It briefly said behaviours needed a bot, because they did: they live in
            LiveRunner and reported what they did by broadcasting to a note's watchers,
            and a socket session was not on the register to have any. Registering it
            closed that gap, so the note-taker works with a microphone too and the
            disclaimer is gone rather than merely hidden.
          */}
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
              {live.spoken.length > 0 &&
                ` It has spoken ${live.spoken.length} time${live.spoken.length === 1 ? '' : 's'}.`}
            </p>
          )}

          {live.extraction?.summary && (
            <section>
              <h3>So far</h3>
              <p>{live.extraction.summary}</p>
              {live.extraction.openQuestions.length > 0 && (
                <>
                  <h3>Open questions</h3>
                  <ul className="cards">
                    {live.extraction.openQuestions.map((q) => (
                      <li key={q} className="muted">
                        {q}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {live.aiNotes && (
            <section>
              <h3>Notes so far</h3>
              {/* Pre-wrapped rather than rendered as markdown: this is a live draft that
                  changes every ninety seconds, and the finished version is written to the
                  note when the meeting ends. */}
              <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
                {live.aiNotes}
              </p>
            </section>
          )}

          {live.proposals.length > 0 && (
            <section>
              <h3>Suggested</h3>
              <ul className="cards">
                {live.proposals.map((p) => (
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
              {live.lines.length === 0 ? (
                <p className="muted">Listening…</p>
              ) : (
                live.lines.map((line) => (
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

      {live.error && <p className="error">{live.error}</p>}
      <section>
        <h3>How forward it is</h3>
        <ul className="agenda">
          {DIALS.map(({ dial, label, hint }) => (
            <Dial
              key={dial}
              dial={dial}
              label={label}
              hint={hint}
              level={eagerness[dial]}
              /*
               * The speech dial is inert while the agent is muted, and says so by being
               * disabled rather than by disappearing — a control that vanishes reads as a
               * missing feature, and this one is a keystroke away from mattering.
               */
              disabled={dial === 'speech' && !maySpeak}
              onChange={(next: EagernessLevel) =>
                configure({ eagerness: { ...eagerness, [dial]: next } as Eagerness })
              }
            />
          ))}
        </ul>
        <p className="muted">
          Kept with this note, so a meeting you record every week starts where you left
          it. New notes start from their template.
        </p>
      </section>

    </div>
  );
}
