import { useCallback, useEffect, useState } from 'react';
import { NOTIFICATION_CATEGORIES, type NotificationSettings as Settings } from '@platform/contracts';
import { api } from '../lib/api.js';
import { PageHeader } from './ui/layout.js';
import { Card } from './ui/card.js';
import { Button, Field } from './ui/primitives.js';
import { useDocumentTitle } from './useDocumentTitle.js';
import { currentEndpoint, enablePush, isIOS, pushState, type PushState } from './push.js';

interface Device {
  id: string;
  label: string;
  createdAt: string;
  lastSuccessAt: string | null;
  current: boolean;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * How you want to be told — for the person asking, nobody else.
 *
 * The defaults are chosen to be right for somebody who never opens this page
 * (docs/notifications-brief.md N9), so it is ordered by what people actually come here for:
 * getting pushes onto this device first, then what may buzz, then when.
 */
export function NotificationSettings() {
  useDocumentTitle('Notifications');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    const endpoint = await currentEndpoint();
    const q = endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : '';
    setDevices(await api.get<Device[]>(`/core/notifications/push/devices${q}`).catch(() => []));
  }, []);

  useEffect(() => {
    api
      .get<Settings>('/core/notifications/settings')
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'));
    void loadDevices();
  }, [loadDevices]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const turnOn = () =>
    run(async () => {
      const next = await enablePush();
      setState(next);
      await loadDevices();
      if (next === 'on') {
        // Straight away: the only way to know it works is to see one arrive.
        const r = await api.post<{ delivered: boolean; error?: string }>('/core/notifications/push/test', {});
        setMessage(r.delivered ? 'A test notification is on its way.' : `Could not send a test: ${r.error}`);
      }
    });

  const test = () =>
    run(async () => {
      const r = await api.post<{ delivered: boolean; error?: string }>('/core/notifications/push/test', {});
      setMessage(r.delivered ? 'Sent — it should appear in a moment.' : `Could not send: ${r.error}`);
    });

  const remove = (id: string) =>
    run(async () => {
      await api.del('/core/notifications/push/devices', { id });
      await loadDevices();
      setState(await pushState());
    });

  const save = () =>
    run(async () => {
      if (!settings) return;
      setSettings(await api.put<Settings>('/core/notifications/settings', settings));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    });

  const set = (patch: Partial<Settings>) => settings && setSettings({ ...settings, ...patch });

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Everything addressed to you lands in the Inbox. This page decides what may also reach your phone or laptop, and when."
      />

      <Card span={12} title="This device">
        <DeviceState state={state} />
        <div className="row">
          {(state === 'off' || state === 'on') && (
            <Button variant={state === 'off' ? 'primary' : 'default'} disabled={busy} onClick={() => void (state === 'off' ? turnOn() : test())}>
              {state === 'off' ? 'Turn on notifications here' : 'Send a test'}
            </Button>
          )}
        </div>
        {message && <p className="muted">{message}</p>}

        {devices.length > 0 && (
          <ul className="device-list">
            {devices.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{d.label}</strong>
                  {d.current && <span className="muted"> · this device</span>}
                  <span className="muted">
                    {' '}
                    · {d.lastSuccessAt ? `last reached ${new Date(d.lastSuccessAt).toLocaleDateString()}` : 'not reached yet'}
                  </span>
                </span>
                <button type="button" className="link-button destructive" onClick={() => void remove(d.id)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {settings && (
        <>
          <Card
            span={12}
            title="What may buzz"
            sub="Only things addressed to you by name or about your own time ever push; the rest wait in the Inbox."
          >
            <ul className="toggle-list">
              {NOTIFICATION_CATEGORIES.map((c) => (
                <li key={c.key}>
                  <label>
                    <input
                      type="checkbox"
                      checked={settings.push[c.key] !== false}
                      onChange={(e) => set({ push: { ...settings.push, [c.key]: e.target.checked } })}
                    />
                    <span>
                      <strong>{c.label}</strong>
                      <span className="muted"> — {c.description}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </Card>

          <Card
            span={12}
            title="When"
            sub="Outside these hours nothing pushes. What arrives is held, and comes as one notification when your day starts."
          >
            <div className="day-picker" role="group" aria-label="Working days">
              {DAYS.map((d, i) => {
                const day = i + 1;
                const on = settings.workDays.includes(day);
                return (
                  <button
                    key={d}
                    type="button"
                    className={on ? 'chip chip-on' : 'chip'}
                    aria-pressed={on}
                    onClick={() =>
                      set({
                        workDays: on
                          ? settings.workDays.filter((x) => x !== day)
                          : [...settings.workDays, day].sort(),
                      })
                    }
                  >
                    {d}
                  </button>
                );
              })}
            </div>
            <ul className="toggle-list brief-toggle">
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.brief.enabled}
                    onChange={(e) => set({ brief: { enabled: e.target.checked } })}
                  />
                  <span>
                    <strong>Morning brief</strong>
                    <span className="muted">
                      {' '}
                      — one notification as your day starts, saying what is waiting, instead of one
                      for each thing that did not need to interrupt you.
                    </span>
                  </span>
                </label>
              </li>
            </ul>
            <div className="hours-row">
              <Field label="From" type="time" value={settings.workStart} onChange={(e) => set({ workStart: e.target.value })} />
              <Field label="Until" type="time" value={settings.workEnd} onChange={(e) => set({ workEnd: e.target.value })} />
              <Field
                label="Time zone"
                value={settings.timeZone}
                list="time-zones"
                onChange={(e) => set({ timeZone: e.target.value })}
              />
              <datalist id="time-zones">
                {(Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone').map((z) => (
                  <option key={z} value={z} />
                ))}
              </datalist>
            </div>
          </Card>

          <Card
            span={12}
            title="A clock left running"
            sub="Reminders about your own timer, during working hours only — a clock left on overnight is mentioned the next morning, where the Time page asks for the hours you actually worked."
          >
            <ul className="toggle-list">
              <li>
                <label>
                  <input
                    type="checkbox"
                    checked={settings.timer.enabled}
                    onChange={(e) => set({ timer: { ...settings.timer, enabled: e.target.checked } })}
                  />
                  <span>
                    <strong>Remind me</strong>
                  </span>
                </label>
              </li>
              {settings.timer.enabled && (
                <>
                  <li>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.timer.afterHours > 0}
                        onChange={(e) =>
                          set({ timer: { ...settings.timer, afterHours: e.target.checked ? 3 : 0 } })
                        }
                      />
                      <span>
                        After{' '}
                        <input
                          type="number"
                          min={1}
                          max={12}
                          className="inline-number"
                          aria-label="Hours before the first reminder"
                          value={settings.timer.afterHours || 3}
                          disabled={settings.timer.afterHours === 0}
                          onChange={(e) =>
                            set({ timer: { ...settings.timer, afterHours: Math.max(1, Number(e.target.value) || 3) } })
                          }
                        />{' '}
                        hours of running
                      </span>
                    </label>
                  </li>
                  <li>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.timer.endOfDay}
                        onChange={(e) => set({ timer: { ...settings.timer, endOfDay: e.target.checked } })}
                      />
                      <span>When the working day ends and it is still running</span>
                    </label>
                  </li>
                  <li>
                    <label>
                      <input
                        type="checkbox"
                        checked={settings.timer.overnight}
                        onChange={(e) => set({ timer: { ...settings.timer, overnight: e.target.checked } })}
                      />
                      <span>The morning after, if it ran overnight</span>
                    </label>
                  </li>
                </>
              )}
            </ul>
          </Card>

          <div className="row">
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              Save
            </Button>
            {saved && <span className="muted">saved</span>}
          </div>
        </>
      )}
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** One sentence on where this device stands, and — when it cannot — exactly why. */
function DeviceState({ state }: { state: PushState | null }) {
  if (state === null) return <p className="muted">Checking this device…</p>;
  switch (state) {
    case 'on':
      return <p>Notifications are on for this device.</p>;
    case 'off':
      return <p className="muted">Notifications are off for this device.</p>;
    case 'denied':
      return (
        <p className="muted">
          This browser was told not to allow notifications from Finsera. Allow them in the
          browser&rsquo;s site settings, then come back here.
        </p>
      );
    case 'not-configured':
      return <p className="muted">Push is not set up on this server yet — the Inbox still has everything.</p>;
    case 'needs-install':
      return (
        <div className="install-steps">
          <p>
            On {isIOS() ? 'an iPhone or iPad' : 'this device'}, notifications only work once Finsera is on
            your Home Screen:
          </p>
          <ol>
            <li>
              Tap <strong>Share</strong> in Safari&rsquo;s toolbar.
            </li>
            <li>
              Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
            </li>
            <li>Open Finsera from the Home Screen and come back to this page.</li>
          </ol>
        </div>
      );
    default:
      return <p className="muted">This browser cannot receive notifications.</p>;
  }
}
