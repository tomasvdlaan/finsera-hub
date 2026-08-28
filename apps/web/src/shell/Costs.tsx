import { useEffect, useState } from 'react';
import { PageHeader, Block } from './ui/layout.js';
import { Card } from './ui/card.js';
import { StatTile, MetricRow } from './ui/data.js';
import { Empty } from './ui/primitives.js';
import { api } from '../lib/api.js';
import { useDocumentTitle } from './useDocumentTitle.js';

interface ModelChoice {
  id: string;
  label: string;
  provider: string;
  note: string;
  /** The company whose model it is. Present on gateway models, absent on direct ones. */
  group?: string;
  /** What one typical answer costs, in micro-euros. Null where it cannot be priced. */
  perAnswerMicros?: number | null;
}

interface ModelSettings {
  current: { strong: string; fast: string; strongFromEnv: boolean; fastFromEnv: boolean };
  options: { strong: ModelChoice[]; fast: ModelChoice[] };
}

interface Breakdown {
  key: string;
  costMicros: number;
  calls: number;
}

interface Summary {
  from: string;
  to: string;
  /** Account balance at the gateway. Null when there is no key, or the call failed. */
  openrouter: { remainingUsd: number; usedUsd: number } | null;
  total: {
    costMicros: number;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  };
  byProvider: Breakdown[];
  byModule: Breakdown[];
  byModel: Breakdown[];
  daily: Array<{ day: string; costMicros: number }>;
}

/**
 * Micro-euros to something a person reads.
 *
 * Two decimals once the figure is over a euro, four below it — because most rows on this page
 * genuinely are fractions of a cent, and rounding them to €0,00 turns the entire embeddings
 * column into a list of zeroes. The threshold rather than a fixed precision, so the headline
 * total is not written as €41,2384 either.
 */
function money(micros: number): string {
  const euros = Number(micros) / 1_000_000;
  const digits = Math.abs(euros) >= 1 || euros === 0 ? 2 : 4;
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(euros);
}

/**
 * Dollars, because OpenRouter bills in them.
 *
 * Deliberately not converted to euros here: everything else on this page is a euro figure this
 * platform worked out, and this one is a number somebody can go and check against OpenRouter's
 * own screen. Converting it would make the two disagree for no reason.
 */
function dollars(usd: number): string {
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'USD' }).format(usd);
}

/** Big token counts, shortened. 1.2M reads; 1234567 does not. */
function compact(n: number): string {
  const v = Number(n);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}

/**
 * The first day of the current month, and today.
 *
 * Formatted from the local calendar fields rather than `toISOString`, which converts to UTC
 * first: local midnight on 1 August is 22:00 on 31 July in Amsterdam, so the obvious version
 * of this opened the page on a range starting the day before the month did — quietly including
 * a day of last month's spending in "this month" every time the clocks were ahead of UTC.
 */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
}

/**
 * An option's text: the name, then what an answer costs.
 *
 * In the option itself rather than only in the note underneath, because the note describes the
 * *current* selection and the comparison happens while the list is open. Ranking forty models
 * by price is the entire reason somebody opens it.
 *
 * Four decimals under a cent, two above, matching the figures higher up the page — the cheap
 * models are genuinely fractions of a cent an answer and rounding them all to €0,00 would hide
 * the difference being shopped for.
 */
function optionText(o: ModelChoice): string {
  if (o.perAnswerMicros === null || o.perAnswerMicros === undefined) return o.label;
  if (o.perAnswerMicros === 0) return `${o.label} — free`;
  const euros = o.perAnswerMicros / 1_000_000;
  // Two decimals only once the figure is over ten cents. Cutting at a cent put '€ 0,01' next
  // to '€ 0,0031' in the same list, which reads as a hundredfold gap and is a threefold one.
  const digits = euros >= 0.1 ? 2 : 4;
  return `${o.label} — ${new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(euros)}`;
}

/**
 * Which model answers, as a choice rather than a redeploy.
 *
 * On this page rather than in Settings because model choice is the single largest lever on
 * the number at the top of it — the gap between the cheapest and dearest option in the list is
 * more than tenfold per token. Somebody reading their spend is exactly the person who wants to
 * change it, and putting it beside the legal identity of the company would have hidden it from
 * the only context that makes it a decision rather than a preference.
 */
function ModelPicker({
  role,
  label,
  hint,
  settings,
  onChange,
}: {
  role: 'strong' | 'fast';
  label: string;
  hint: string;
  settings: ModelSettings;
  onChange: (role: 'strong' | 'fast', model: string | null) => void;
}) {
  const options = settings.options[role];
  const value = settings.current[role];
  const fromEnv = settings.current[role === 'strong' ? 'strongFromEnv' : 'fastFromEnv'];
  const chosen = options.find((o) => o.id === value);

  /*
   * Direct models stay a flat list at the top; gateway models are grouped by the company that
   * made them.
   *
   * There are several hundred of the latter, and an ungrouped list of that length is a wall —
   * the reader is looking for "the Anthropic ones" or "the Mistral ones", not scrolling for a
   * name they already know. `optgroup` also makes the browser's own type-ahead usable, which is
   * the only navigation a native select has.
   */
  const direct = options.filter((o) => !o.group);
  const grouped = options.reduce<Record<string, ModelChoice[]>>((acc, o) => {
    if (!o.group) return acc;
    (acc[o.group] ??= []).push(o);
    return acc;
  }, {});

  return (
    <div className="model-pick">
      <label>
        <span className="model-pick-label">{label}</span>
        <select
          value={fromEnv ? '' : value}
          onChange={(e) => onChange(role, e.target.value === '' ? null : e.target.value)}
        >
          {/*
            The environment's answer is an option rather than a hidden default, so a slot can be
            handed back to it. Without this, choosing once would be irreversible from the UI.
          */}
          <option value="">Follow the server setting ({value})</option>
          {direct.length > 0 && (
            <optgroup label="Direct to the provider">
              {direct.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionText(o)}
                </option>
              ))}
            </optgroup>
          )}
          {Object.entries(grouped).map(([company, models]) => (
            <optgroup key={company} label={`via OpenRouter · ${company}`}>
              {models.map((o) => (
                <option key={o.id} value={o.id}>
                  {optionText(o)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p className="model-pick-note">{chosen && !fromEnv ? chosen.note : hint}</p>
      {/* Said once per picker rather than repeated in every option, which would be unreadable. */}
      <p className="model-pick-note">
        Prices are per answer, estimated from a typical question — about 9,000 tokens in and 250
        out, uncached.
      </p>
      {chosen?.group && (
        /*
          Said at the point of choosing, not in documentation somebody reads later. A direct
          model's prompt goes to the vendor; this one goes through a third party first, and the
          prompts in question carry client material.
        */
        <p className="model-pick-warn">
          Prompts for this model pass through OpenRouter before reaching {chosen.group}.
        </p>
      )}
    </div>
  );
}

/**
 * A breakdown, as a bar per row against the largest.
 *
 * A bar rather than a number alone because the useful fact here is proportion — "meetings is
 * most of it" — and a column of euro amounts makes the reader do that comparison themselves.
 */
function Split({ rows, empty }: { rows: Breakdown[]; empty: string }) {
  if (rows.length === 0) return <Empty>{empty}</Empty>;
  const largest = Math.max(...rows.map((r) => Number(r.costMicros)), 1);

  return (
    <ul className="cost-split">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="cost-split-head">
            <span className="cost-split-key">{row.key}</span>
            <span className="cost-split-value">{money(row.costMicros)}</span>
          </div>
          <div className="cost-split-bar">
            <span style={{ width: `${(Number(row.costMicros) / largest) * 100}%` }} />
          </div>
          <div className="cost-split-hint">
            {row.calls} {row.calls === 1 ? 'call' : 'calls'}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the platform spends at its providers.
 *
 * ## This is a meter, not an invoice
 *
 * Every row is priced by this platform from its own record of what it called, against a rate
 * card in `rates.ts`. That is a deliberate trade: a provider's billing API would give the exact
 * figure and could not say *which* part of the platform spent it, and "the assistant costs this,
 * meetings cost that" is the only version of this question worth a page. Expect a few percent
 * of drift from the real invoice, and read the split and the trend rather than the last cent.
 *
 * The page says so in its subtitle rather than in this comment, because the person reading the
 * number is the person who needs to know how it was made.
 */
export function Costs() {
  useDocumentTitle('Platform costs');
  const [range, setRange] = useState(defaultRange);
  const [summary, setSummary] = useState<Summary>();
  const [failed, setFailed] = useState<string>();
  const [models, setModels] = useState<ModelSettings>();
  const [modelsFailed, setModelsFailed] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSummary(undefined);
    setFailed(undefined);
    api
      .get<Summary>(`/core/costs?from=${range.from}&to=${range.to}`)
      .then(setSummary)
      .catch((e: Error) => setFailed(e.message));
  }, [range.from, range.to]);

  useEffect(() => {
    api
      .get<ModelSettings>('/core/models')
      .then(setModels)
      .catch((e: Error) => setModelsFailed(e.message));
  }, []);

  /**
   * Saved on change, with no confirm step.
   *
   * The action is instant, reversible from the same control, and affects nothing already
   * written — a dialog here would be ceremony around a dropdown. The server is the authority
   * on what the value became, so its answer replaces local state rather than being assumed.
   */
  const chooseModel = (role: 'strong' | 'fast', model: string | null) => {
    setSaving(true);
    setModelsFailed(undefined);
    api
      .put<ModelSettings['current']>(`/core/models/${role}`, { model })
      .then((current) => setModels((m) => (m ? { ...m, current } : m)))
      .catch((e: Error) => setModelsFailed(e.message))
      .finally(() => setSaving(false));
  };

  const total = summary?.total;
  // Cache reads as a share of everything read in: the one number that says whether the prompt
  // cache is earning its keep, and otherwise only answerable from an invoice a month later.
  const cacheShare =
    total && Number(total.inputTokens) + Number(total.cacheReadTokens) > 0
      ? Math.round(
          (Number(total.cacheReadTokens) /
            (Number(total.inputTokens) + Number(total.cacheReadTokens))) *
            100,
        )
      : 0;

  return (
    <>
      <PageHeader
        title="Platform costs"
        subtitle="Metered by this platform from its own calls and priced from a rate card — close to the invoice, not the invoice itself."
        actions={
          <div className="cost-range">
            <label>
              From
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
              />
            </label>
          </div>
        }
      />

      <Block span={12}>
        <Card title="This period" loading={!summary && !failed} error={failed}>
          {total && (
            <MetricRow>
              <StatTile label="Spent" value={money(total.costMicros)} emphasis="hero" />
              <StatTile label="Calls" value={Number(total.calls)} />
              <StatTile label="Tokens in" value={compact(total.inputTokens)} />
              <StatTile label="Tokens out" value={compact(total.outputTokens)} />
              <StatTile
                label="Served from cache"
                value={`${cacheShare}%`}
                hint={cacheShare > 0 ? `${compact(total.cacheReadTokens)} tokens` : 'no cache hits'}
              />
              {/*
                An account balance, not a figure about this period — which is why it sits at the
                end with its own hint rather than among the totals. It is here because running
                out is otherwise silent: the first sign is every answer failing at once.
              */}
              {summary?.openrouter && (
                <StatTile
                  label="OpenRouter balance"
                  value={dollars(summary.openrouter.remainingUsd)}
                  tone={summary.openrouter.remainingUsd < 1 ? 'urgent' : undefined}
                  hint={
                    summary.openrouter.remainingUsd < 1
                      ? 'Low — gateway models will start failing'
                      : `${dollars(summary.openrouter.usedUsd)} used in total`
                  }
                />
              )}
            </MetricRow>
          )}
        </Card>
      </Block>

      <Block span={12}>
        <Card
          title="Models"
          loading={!models && !modelsFailed}
          error={modelsFailed}
        >
          {models && (
            <div className="model-picks" data-saving={saving || undefined}>
              <ModelPicker
                role="strong"
                label="Reasoning"
                hint="Answers questions, reads documents, writes meeting notes."
                settings={models}
                onChange={chooseModel}
              />
              <ModelPicker
                role="fast"
                label="Quick work"
                hint="Live meeting extraction, wake words, conversation titles."
                settings={models}
                onChange={chooseModel}
              />
            </div>
          )}
        </Card>
      </Block>

      <Block span={6}>
        <Card title="By module" loading={!summary && !failed} error={failed}>
          {summary && (
            <Split rows={summary.byModule} empty="Nothing was spent in this period." />
          )}
        </Card>
      </Block>

      <Block span={6}>
        <Card title="By provider" loading={!summary && !failed} error={failed}>
          {summary && <Split rows={summary.byProvider} empty="No provider was called." />}
        </Card>
      </Block>

      <Block span={12}>
        <Card title="By model" loading={!summary && !failed} error={failed}>
          {summary && <Split rows={summary.byModel} empty="No model was called." />}
        </Card>
      </Block>
    </>
  );
}
