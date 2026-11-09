import { useId, useState } from 'react';
import type { MachineHealth } from '@/types/generated/simulation-machine-health';
import { serviceDuration, simulationTime } from '@/lib/simulation/clock';
import type { Simulation } from '@/lib/simulation/types';

export const riskLabel = (risk: number | null) => risk === null ? 'Not available' : risk > 0 && risk < .0001 ? '<0.01%' :
  new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 2 }).format(risk);
const eventNames = { failure: 'Failure detected', start: 'Maintenance started', completion: 'Maintenance completed' };

export function ComponentHealth({ health, session }: { health: MachineHealth; session: Simulation }) {
  const [component, setComponent] = useState(health.components.find(item=>item.failed)?.componentIndex ??
    health.history.events.at(-1)?.componentIndex ?? health.components[0]?.componentIndex ?? 0);
  const heading = useId();
  const current = health.components.find(item => item.componentIndex === component);
  const samples = health.history.samples.filter(item => item.componentIndex === component);
  const events = health.history.events.filter(item => item.componentIndex === component);
  const from = health.history.fromTick;
  const to = Math.max(from + 1, health.tick);
  const x = (tick: number) => 48 + (tick - from) / (to - from) * 554;
  const y = (risk: number) => 150 - risk * 124;
  const segments: string[] = [];
  let segment = '';
  let previousTick: number | undefined;
  for (const sample of samples) {
    const gap = previousTick !== undefined && (sample.tick !== previousTick + 1 ||
      health.history.gaps.some(item => item.fromTick < sample.tick && item.toTick > previousTick!));
    if (sample.failureRisk === null || gap) { if (segment) segments.push(segment); segment = ''; }
    if (sample.failureRisk !== null) segment += `${segment ? ' L' : 'M'}${x(sample.tick)},${y(sample.failureRisk)}`;
    previousTick = sample.tick;
  }
  if (segment) segments.push(segment);
  return <section className="sim-health-section" aria-labelledby={heading}>
    <div className="sim-panel-heading"><h3 id={heading}>Component health</h3><label className="sim-field">Component
      <select value={component} onChange={event => setComponent(Number(event.target.value))}>
        {health.components.map(item => <option key={item.componentIndex} value={item.componentIndex}>C{item.componentIndex + 1}</option>)}
      </select></label></div>
    <div className="sim-health-summary"><strong>{riskLabel(current?.failureRisk ?? null)}</strong><span>Next operating interval risk</span>
      {current?.riskUnavailableReason && <span>{current.riskUnavailableReason === 'IN_SERVICE' ? 'In service — not applicable' : 'Machine stopped — not applicable'}</span>}</div>
    <p className="sim-footnote">Probability of failure in the next interval if the machine operates, from JCST simulation data. Gaps indicate missing or non-applicable risk, not zero.</p>
    {health.history.truncated && <p role="status" className="sim-inspection-note">Partial history. Earlier intervals are not retained or were omitted.</p>}
    {!!health.history.gaps.length && <p className="sim-footnote">Missing intervals: {health.history.gaps.map(gap => `t${gap.fromTick}–t${gap.toTick}`).join(', ')}.</p>}
    <figure className="sim-health-chart" tabIndex={0} aria-label="Scrollable component risk chart"><svg viewBox="0 0 628 200" role="img" aria-label={`C${component + 1} failure risk over simulated time`}>
      <title>JCST conditional failure probability (%)</title>
      {[0, .5, 1].map(value => <g key={value}><line x1="48" x2="602" y1={y(value)} y2={y(value)} className="sim-chart-grid"/><text x="40" y={y(value) + 4} textAnchor="end">{value * 100}%</text></g>)}
      {segments.map((d, index) => <path key={index} d={d} className="sim-risk-line" data-testid="risk-segment"/>)}
      {samples.filter(sample => sample.failureRisk !== null).map(sample => <circle key={`${sample.tick}:${sample.sampleKind}`} cx={x(sample.tick)} cy={y(sample.failureRisk!)} r="2.5" className="sim-risk-point"><title>t{sample.tick}: {riskLabel(sample.failureRisk)}</title></circle>)}
      {events.map(event => <g key={event.eventId} data-event={event.type} className="sim-health-marker"><line x1={x(event.tick)} x2={x(event.tick)} y1="24" y2="154"/><circle cx={x(event.tick)} cy="19" r="4"/><title>{eventNames[event.type]} · t{event.tick}</title></g>)}
      <text x="48" y="174">t{from} · {simulationTime(session, from).time}</text><text x="602" y="174" textAnchor="end">t{health.tick} · {simulationTime(session, health.tick).time}</text>
      <text x="325" y="194" textAnchor="middle">Simulated time · {serviceDuration(1, health.stepSeconds)} / interval</text>
    </svg><figcaption>Failure / maintenance start / completion markers use the same simulated clock.</figcaption></figure>
    <h4>Component milestones</h4>
    {events.length ? <ol className="sim-health-milestones" aria-label={`C${component + 1} milestones`}>
      {events.map(event => <li key={event.eventId} tabIndex={0} data-event={event.type}><strong>{eventNames[event.type]}</strong><span>t{event.tick} · <time dateTime={simulationTime(session, event.tick).iso}>{simulationTime(session, event.tick).time}</time>{event.technicianIndex === null ? '' : ` · T${event.technicianIndex + 1}`}</span></li>)}
    </ol> : <p className="sim-footnote">No recorded milestones for this component in the available history.</p>}
    <details className="sim-compatibility"><summary>Risk samples as a table</summary><div className="sim-table-scroll" tabIndex={0} role="region" aria-label="Risk sample table"><table className="sim-metrics-table"><thead><tr><th>Tick / time</th><th>Risk</th><th>Applicability</th></tr></thead><tbody>
      {samples.map(sample => <tr key={`${sample.tick}:${sample.sampleKind}`}><th>t{sample.tick} · {simulationTime(session, sample.tick).time}</th><td>{riskLabel(sample.failureRisk)}</td><td>{sample.riskUnavailableReason?.replaceAll('_', ' ') ?? (sample.failureRisk === null ? 'Missing data' : 'Operating interval')}</td></tr>)}
      {!samples.length && <tr><td colSpan={3}>No risk history provided.</td></tr>}
    </tbody></table></div></details>
  </section>;
}
