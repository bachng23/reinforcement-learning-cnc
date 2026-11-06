"use client";
import type { CurvePoint } from '@/types/generated/jcst';

const arms: Record<string, { color: string; dash?: string }> = {
  S: { color: '#266df0' }, A: { color: '#137c75', dash: '6 3' }, F: { color: '#8c5ab5', dash: '2 3' },
};
export function LearningCurve({ points, axis = 'samples' }: { points: CurvePoint[]; axis?: 'samples' | 'time' }) {
  const values = points.filter(p => p.mode === 'greedy' && (axis === 'samples' || p.training_seconds != null));
  if (!values.length) return <p className="text-sm text-ash-gray">No {axis === 'time' ? 'measured training time' : 'sample curve'} data available.</p>;
  const xValue = (p: CurvePoint) => axis === 'samples' ? p.samples : p.training_seconds!;
  const xmin = Math.min(...values.map(xValue)); const xmax = Math.max(...values.map(xValue));
  const ymin = Math.min(...values.map(p => p.mean_total_cost)); const ymax = Math.max(...values.map(p => p.mean_total_cost));
  const x = (v: number) => 65 + 800 * (v - xmin) / (xmax - xmin || 1);
  const y = (v: number) => 260 - 230 * (v - ymin) / (ymax - ymin || 1);
  const groups = new Map<string, CurvePoint[]>();
  for (const p of values) { const key = `${p.arm}/${p.training_root}`; groups.set(key, [...(groups.get(key) || []), p]); }
  const formatX = (v: number) => axis === 'samples' && v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0);
  return <figure className="learning-curve">
    <figcaption className="learning-curve-heading"><strong>H + tail cost by {axis === 'samples' ? 'simulator decisions' : 'measured training seconds'}</strong><span>Greedy evaluation · lower cost is better</span></figcaption>
    <svg viewBox="0 0 900 300" role="img" aria-label={`Per-root ${axis} learning curves; lower cost is better`}>
      {[0, .25, .5, .75, 1].map(t => { const v = ymin + (ymax - ymin) * t; return <g key={t}><text x="52" y={y(v) + 4} textAnchor="end" fontSize="11" fill="#626873">{v.toFixed(0)}</text><path d={`M65 ${y(v)} H865`} stroke="#eeeff1" /></g>; })}
      {[...groups.entries()].map(([key, rows]) => <polyline key={key} points={rows.sort((a,b) => xValue(a)-xValue(b)).map(p => `${x(xValue(p))},${y(p.mean_total_cost)}`).join(' ')} fill="none" stroke={arms[rows[0].arm]?.color || '#505967'} strokeDasharray={arms[rows[0].arm]?.dash} strokeWidth="1.6" opacity="0.8"><title>{key}</title></polyline>)}
      {[0, .25, .5, .75, 1].map(t => { const v = xmin + (xmax-xmin) * t; return <text key={t} x={x(v)} y="286" textAnchor="middle" fontSize="11" fill="#626873">{formatX(v)}</text>; })}
    </svg><div className="curve-legend">{Object.entries(arms).filter(([arm]) => values.some(p => p.arm === arm)).map(([arm, { color, dash }]) => <span key={arm}><i style={{ borderTop: `3px ${dash ? (arm === 'F' ? 'dotted' : 'dashed') : 'solid'} ${color}` }} aria-hidden="true" />{arm} · individual training roots</span>)}</div>
  </figure>;
}
