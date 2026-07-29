# Phase 6c — The live meeting agent

**Status:** ✅ stage 1 built and verified in a real meeting (2026-07-28)
**Gate:** G3 decided, then revised — see [decision-log.md](decision-log.md)
**Parent:** [build-roadmap.md](build-roadmap.md) §Phase 6

---

## 1. What it does

A named bot joins a Microsoft Teams meeting. Each participant's audio arrives on its own
channel with their roster identity attached, is transcribed by Gemini, and appears live on
screen. While the meeting runs, a rolling-window extraction proposes action points,
decisions and agenda coverage. Optionally the bot speaks back.

Nothing it proposes is applied. Action points land in the same `proposed` state a typed
one starts in, so accepting them uses the path that already existed.

## 2. What was proven in a real meeting

**Speaker attribution works, with real names.** The saved transcript reads
`**Tomas van der Laan:** Jo, jo, alles goed met jullie?` — not "Speaker 1". This was the
entire justification for choosing Recall over the cheaper alternatives, and it is a
property of the transport rather than an inference, so crosstalk cannot break it.

**Dutch transcription is good**, including fast colloquial speech, on the cheap model.

**The bot can hold a conversation**, at roughly 4.5 seconds per turn.

## 3. The architecture, and why it is shaped this way

```
Recall bot ──per-speaker audio──▶ API ──▶ Gemini (transcribe)
                                   ├──▶ Gemini (extract, rolling window)
                                   └──▶ TTS ──▶ MP3 ──▶ Recall ──▶ the meeting
```

Capture sits behind `MeetingCaptureProvider`. That is not speculative generality: Microsoft
is actively restricting third-party bots in Teams, a client whose DPA forbids
sub-processors cannot use a hosted bot at all, and the browser dual-stream fallback needs
somewhere to live. Swapping provider is an adapter, not a rewrite.

**Audio is never persisted.** Recall's defaults record video and retain forever; both are
overridden, and the recording is deleted when the bot leaves.

**Cost is controlled by voice-activity gating per stream.** Four participants for an hour
is four stream-hours of audio; transcribing all of it would cost 4× to learn that three
people were silent.

## 4. Latency, measured

| Stage | Time |
|---|---|
| Waiting for the speaker to pause | 0.4s |
| Transcribe | ~1.5s |
| Decide what to say | 0.66s |
| Synthesise speech (local) | 0.86s |
| Upload and play | ~0.5s |

**~4s per turn.** The floor for this architecture, which runs three round trips in
sequence. Genuine conversational latency needs a speech-to-speech model (Gemini Live),
which means an open audio pipe to Google for the whole meeting — a different data posture,
and its own decision.

Speech is synthesised by the operating system where available (0.86s) rather than the
hosted model (~2.8s): in a live meeting speed beats timbre, and three seconds of silence
is more noticeable than a synthetic voice.

## 5. What this cost to get working

Five bugs, four of them silent — worth recording because the pattern repeats:

| Bug | Why it was invisible |
|---|---|
| Vite did not proxy WebSocket upgrades | REST kept working, so the page looked healthy while the socket never connected |
| `window.prompt` for adding attendees | Browsers suppress repeated dialogs; the button simply did nothing |
| MP3 encoder is ESM-only | A CommonJS `require` of an ESM package yields an empty object, not an error |
| Recall parser dropped unknown frames | Every branch returned early, leaving nothing in the logs |
| StrictMode opened two sockets | Both were legitimate connections; every line simply arrived twice |

The lesson is the same each time: **failures that produce no error are the expensive
ones.** Logging unrecognised input, and testing the built artefact rather than only the
source, would have caught four of the five.

## 6. Deliberately not built

- **Stage 2 (agenda drift and steering).** Worth judging after the quiet version has been
  used in a real client meeting; it is the part most likely to be annoying rather than
  useful.
- **A portable local synthesiser.** `say` is macOS-only, so a Linux server falls back to
  the hosted model and its ~2.8s. Piper behind the same seam closes that.
- **Wake-word Q&A.** At ~4s an unprompted interjection lands awkwardly, but an answer to a
  question you asked feels normal. Likely the better product than a talkative agent.
