import { useState } from 'react';
import type { DemoIncident } from '@/types/generated/demo-read';

export const incidentStatusLabel = {OPEN: 'Open', IN_SERVICE: 'In service', RESOLVED: 'Resolved'} as const;
export function IncidentCenter({incidents, scope, onInspect}: {incidents: DemoIncident[]; scope: string; onInspect: (incident: DemoIncident) => void}) {
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState('ACTIVE');
  const [local, setLocal] = useState<{scope: string; ids: string[]}>();
  let stored: string[] = [];
  try { const value: unknown = JSON.parse(localStorage.getItem(`jcst-read:${scope}`) || '[]'); if (Array.isArray(value)) stored = value.filter((id): id is string => typeof id === 'string'); } catch {}
  const seen = local?.scope === scope ? local.ids : stored;
  const visible = incidents.filter(incident => filter === 'ALL' || (filter === 'ACTIVE' ? incident.status !== 'RESOLVED' : incident.status === filter));
  const unread = incidents.filter(incident => !seen.includes(incident.incidentId)).length;
  function inspect(incident: DemoIncident) {
    const ids = [...new Set([...seen, incident.incidentId])].slice(-384); setLocal({scope, ids});
    try { localStorage.setItem(`jcst-read:${scope}`, JSON.stringify(ids)); } catch {}
    onInspect(incident);
  }
  return <section className="sim-panel live-incident-center" aria-labelledby="incident-center-title">
    <div className="sim-panel-heading"><div><h2 id="incident-center-title">Incident center</h2><p>{incidents.filter(incident => incident.status !== 'RESOLVED').length} active · {unread} unread locally</p></div><button className="sim-button" onClick={() => setExpanded(value => !value)}>{expanded ? 'Compact view' : 'View history'}</button></div>
    <label className="sim-field">Incident status<select value={filter} onChange={event => {setFilter(event.target.value); setExpanded(true);}}><option value="ACTIVE">Active incidents</option><option value="OPEN">Open</option><option value="IN_SERVICE">In service</option><option value="RESOLVED">Resolved</option><option value="ALL">All incidents</option></select></label>
    <ul className="live-incident-list">{(expanded ? visible : visible.slice(0, 3)).map(incident => <li key={incident.incidentId}><button type="button" onClick={() => inspect(incident)} aria-label={`Inspect incident ${incident.machineId}/${incident.componentId} at tick ${incident.openedAtTick}`}>
      <strong>{incident.machineId}/{incident.componentId}<span className={`live-status state-${incident.status}`}>{incidentStatusLabel[incident.status]}</span></strong>
      <span>Failure at tick {incident.openedAtTick}{!seen.includes(incident.incidentId) ? ' · Unread' : ''}</span>
      <small>{incident.incidentId}</small>
    </button></li>)}</ul>
    {!visible.length && <p className="sim-footnote" role="status">No incidents match this filter.</p>}
    {!expanded && visible.length > 3 && <p className="sim-footnote">{visible.length - 3} more in history.</p>}
    <p className="sim-footnote">Read/unread is stored only in this browser. It never changes server incident status.</p>
  </section>;
}
