// Prints the audit of FLOOR_MAP and exits 1 when the planner would drop
// any record. Run: npm run map:check
import { COURSE_DESTINATIONS, FLOOR_MAP } from '../lib/floor-map.mjs';
import { auditMap } from '../lib/route-planner.mjs';

const audit = auditMap(FLOOR_MAP);

console.log(`Anchors: ${FLOOR_MAP.anchors.length} authored, ` +
  `${audit.rejected.filter(r => r.kind === 'anchor').length} rejected`);
console.log(`Edges:   ${FLOOR_MAP.edges.length} authored, ` +
  `${audit.rejected.filter(r => r.kind === 'edge').length} rejected`);

if (audit.rejected.length) {
  console.log('\nREJECTED RECORDS');
  for (const { kind, id_or_index, reason } of audit.rejected) {
    console.log(`  ${kind} ${id_or_index}: ${reason}`);
  }
}

if (audit.warnings.length) {
  console.log('\nWARNINGS');
  for (const warning of audit.warnings) console.log(`  ${warning}`);
}

if (audit.routes.length) {
  console.log('\nROUTES');
  const groups = new Map();
  for (const row of audit.routes) {
    const key = `${row.from}${row.pose ? ` (facing ${row.pose})` : ''}`;
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  for (const [origin, rows] of groups) {
    console.log(`\nfrom ${origin}`);
    for (const row of rows) {
      if (row.legs) {
        console.log(`  -> ${row.destination}:`);
        row.legs.forEach((leg, index) => console.log(`     ${index + 1}. ${leg.command}`));
      } else {
        console.log(`  -> ${row.destination}: ${row.status}`);
      }
    }
  }
} else {
  console.log('\nROUTES\n  No checked anchors; nothing to route.');
  console.log(`  Destinations: ${COURSE_DESTINATIONS.join(', ')}`);
}

process.exitCode = audit.rejected.length ? 1 : 0;
