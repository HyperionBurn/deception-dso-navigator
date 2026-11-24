// Prints the audit of a map and, run directly, audits FLOOR_MAP and exits 1
// when the planner would drop any record. Run: npm run map:check
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COURSE_DESTINATIONS, FLOOR_MAP } from '../lib/floor-map.mjs';
import { auditMap } from '../lib/route-planner.mjs';

export function printAudit(map, audit, out = console.log) {
  out(`Anchors: ${map.anchors.length} authored, ` +
    `${audit.rejected.filter(r => r.kind === 'anchor').length} rejected`);
  out(`Edges:   ${map.edges.length} authored, ` +
    `${audit.rejected.filter(r => r.kind === 'edge').length} rejected`);

  if (audit.rejected.length) {
    out('\nREJECTED RECORDS');
    for (const { kind, id_or_index, reason } of audit.rejected) {
      out(`  ${kind} ${id_or_index}: ${reason}`);
    }
  }

  if (audit.warnings.length) {
    out('\nWARNINGS');
    for (const warning of audit.warnings) out(`  ${warning}`);
  }

  if (audit.routes.length) {
    out('\nROUTES');
    const groups = new Map();
    for (const row of audit.routes) {
      const key = `${row.from}${row.pose ? ` (facing ${row.pose})` : ''}`;
      const rows = groups.get(key) ?? [];
      rows.push(row);
      groups.set(key, rows);
    }
    for (const [origin, rows] of groups) {
      out(`\nfrom ${origin}`);
      for (const row of rows) {
        if (row.legs) {
          out(`  -> ${row.destination}:`);
          row.legs.forEach((leg, index) => out(`     ${index + 1}. ${leg.command}`));
        } else {
          out(`  -> ${row.destination}: ${row.status}`);
        }
      }
    }
  } else {
    out('\nROUTES\n  No checked anchors; nothing to route.');
    out(`  Destinations: ${COURSE_DESTINATIONS.join(', ')}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const audit = auditMap(FLOOR_MAP);
  printAudit(FLOOR_MAP, audit);
  process.exitCode = audit.rejected.length ? 1 : 0;
}
