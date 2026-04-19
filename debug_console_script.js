/* =====================================================================
 *  TeamDeathmatch — NavMesh / AI Deep-Inspect Dump
 *  Paste into the browser console after the arena has loaded.
 * ===================================================================== */
(() => {
  const td = window.__td;
  if (!td) { console.error('❌ window.__td not found. Reload the page — main.ts must run the expose block.'); return; }
  const { gameState: gs, navMeshManager: nmm } = td;
  const nm = nmm?.navMesh;

  let report = '# TeamDeathmatch AI / NavMesh Debug Dump\n\n';
  report += `Generated: ${new Date().toLocaleString()}\n\n`;

  const group = (label, fn) => {
    console.groupCollapsed(`%c${label}`, 'color:#40f5a2;font-weight:bold');
    report += `\n## ${label}\n\n`;
    try { fn(); } catch (e) { console.error(e); report += `> ❌ Error in section: ${e.message}\n\n`; }
    console.groupEnd();
  };

  const line = (txt, log = true) => {
    if (log) console.log(txt);
    report += (txt || '').toString().replace(/%c/g, '') + '\n';
  };

  const mdTable = (data) => {
    if (!data || !data.length) return '';
    const keys = Object.keys(data[0]);
    let res = '| ' + keys.join(' | ') + ' |\n';
    res += '| ' + keys.map(() => '---').join(' | ') + ' |\n';
    data.forEach(row => {
      res += '| ' + keys.map(k => {
        const val = row[k];
        return (val === undefined || val === null) ? '' : String(val).replace(/\|/g, '\\|');
      }).join(' | ') + ' |\n';
    });
    return res + '\n';
  };

  const v3 = (v) => v ? `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})` : 'null';

  console.log('%c═══ TeamDeathmatch AI / NavMesh Debug Dump ═══', 'color:#57a0ff;font-size:14px;font-weight:bold');

  // ───────────────────────────────────────────────────────────────────
  group('1. NavMesh health', () => {
    if (!nm) { line('No navmesh loaded.'); return; }
    const regions = nm.regions;
    const comps = nmm.components || [];
    const main = nmm.mainComponent || new Set();
    line(`total regions: ${regions.length}`);
    line(`components   : ${comps.length}`);
    line(`main component size: ${main.size} (${((main.size / regions.length) * 100).toFixed(1)}%)`);
    line(`component sizes (largest-first): ${JSON.stringify(comps.slice(0, 10).map(c => c.length))}`);

    // polygon vertex stats
    let minV = Infinity, maxV = 0, total = 0;
    for (const r of regions) {
      let e = r.edge, n = 0, g = 0;
      do { n++; e = e.next; if (++g > 100) break; } while (e && e !== r.edge);
      minV = Math.min(minV, n); maxV = Math.max(maxV, n); total += n;
    }
    line(`vertices/region: min=${minV} max=${maxV} avg=${(total / regions.length).toFixed(2)}`);

    // twin-edge count (connectivity)
    let twin = 0;
    for (const r of regions) {
      let e = r.edge, g = 0;
      do { if (e.twin) twin++; e = e.next; if (++g > 100) break; } while (e && e !== r.edge);
    }
    line(`half-edges with twin: ${twin} (higher = better connectivity)`);

    // bounding box (manual, no THREE dependency)
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const r of regions) {
      let e = r.edge, g = 0;
      do {
        const p = e.vertex ?? (typeof e.from === 'function' ? e.from() : null);
        if (p) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); minZ = Math.min(minZ, p.z);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); maxZ = Math.max(maxZ, p.z);
        }
        e = e.next; if (++g > 100) break;
      } while (e && e !== r.edge);
    }
    line(`mesh AABB: x[${minX.toFixed(1)}, ${maxX.toFixed(1)}] y[${minY.toFixed(1)}, ${maxY.toFixed(1)}] z[${minZ.toFixed(1)}, ${maxZ.toFixed(1)}]`);
  });

  // ───────────────────────────────────────────────────────────────────
  group('2. Arena geometry', () => {
    line(`wallMeshes (visual, in scene)       : ${gs.wallMeshes?.length ?? 0}`);
    line(`arenaColliders (used by NavMeshBuilder): ${gs.arenaColliders?.length ?? 0}`);
    line(`colliders (used by player collision) : ${gs.colliders?.length ?? 0}`);
    line(`yukaObs (ObstacleAvoidanceBehavior)  : ${gs.yukaObs?.length ?? 0}`);
    if ((gs.arenaColliders?.length ?? 0) === 0) {
      line('⚠ arenaColliders is EMPTY — procedural arena is disabled.');
      line('  The runtime NavMeshBuilder would produce a wall-less grid.');
      line('  Baked arena_navmesh.gltf is the only real source of walls.');
    }
    if (gs.arenaColliders?.length) {
      const byType = gs.arenaColliders.reduce((a, c) => { a[c.type] = (a[c.type] || 0) + 1; return a; }, {});
      line(`arenaColliders by type: ${JSON.stringify(byType)}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────
  group('3. Spawn positions — main-component membership', () => {
    if (!nm) return;
    const probes = [];
    const agents = gs.agents ?? [];
    for (const ag of agents) {
      if (!ag.spawnPos) continue;
      const pos = ag.spawnPos;
      const region = nm.getRegionForPoint(pos, 1) || (typeof nm.getClosestRegion === 'function' ? nm.getClosestRegion(pos) : null);
      const inMain = region && nmm.mainComponent.has(region);
      probes.push({ name: ag.name, team: ag.team, pos: v3(pos), regionFound: !!region, inMainComponent: !!inMain });
    }
    console.table(probes);
    report += mdTable(probes);
  });

  // ───────────────────────────────────────────────────────────────────
  group('4. Per-agent runtime snapshot', () => {
    const agents = (gs.agents ?? []).filter(a => a !== gs.player);
    const rows = [];
    for (const a of agents) {
      const nr = a.navRuntime;
      const speed = Math.hypot(a.velocity?.x || 0, a.velocity?.y || 0, a.velocity?.z || 0);
      const region = nr?.currentRegion;
      const inMain = region ? nmm.mainComponent.has(region) : false;
      const pathLen = nr?.path?.length ?? 0;
      rows.push({
        name: a.name,
        team: a.team,
        HP: a.health?.toFixed?.(0) ?? '?',
        dead: !!(a.dead),
        pos: v3(a.position),
        speed: speed.toFixed(2),
        maxS: a.maxSpeed?.toFixed?.(2),
        reg: region ? '✓' : '✗',
        main: inMain ? '✓' : '✗',
        path: pathLen,
        pend: nr?.pathPending ? '✓' : '',
        follow: nr?.followPathBehavior?.active ? '✓' : '',
      });
    }
    console.table(rows);
    report += mdTable(rows);
  });

  // ───────────────────────────────────────────────────────────────────
  group('5. Steering behaviors per agent', () => {
    const agents = (gs.agents ?? []).filter(a => a !== gs.player);
    for (const a of agents) {
      const bs = a.steering?.behaviors ?? [];
      const rows = bs.map(b => {
        const name = b.constructor?.name;
        let extra = '';
        if (name === 'SeekBehavior') extra = v3(b.target);
        else if (name === 'PursuitBehavior') extra = `evader=${b.evader?.name || '?'}`;
        else if (name === 'FollowPathBehavior') extra = `wpN=${b.path?._waypoints?.length ?? 0}`;
        return { type: name, active: !!b.active, weight: (b.weight ?? 1).toFixed(2), extra };
      });
      line(`### agent: ${a.name} (team ${a.team})`, false);
      console.groupCollapsed(`  ${a.name} (team ${a.team}) — ${bs.length} behaviors`);
      console.table(rows);
      report += mdTable(rows);
      console.groupEnd();
    }
  });

  // ───────────────────────────────────────────────────────────────────
  group('6. Random path smoke-test', () => {
    if (!nm) return;
    const main = [...(nmm.mainComponent || [])];
    if (main.length < 2) { line('main component too small'); return; }
    let ok = 0, fail = 0;
    const samples = Math.min(25, main.length >> 1);
    for (let i = 0; i < samples; i++) {
      const a = main[(Math.random() * main.length) | 0].centroid;
      const b = main[(Math.random() * main.length) | 0].centroid;
      try {
        const path = nm.findPath(a.clone(), b.clone());
        if (Array.isArray(path) && path.length >= 2) ok++; else fail++;
      } catch { fail++; }
    }
    line(`smoke test: ${ok}/${samples} paths succeeded (${fail} failed)`);
  });

  // ───────────────────────────────────────────────────────────────────
  group('7. findPath cross-check', () => {
    const agents = (gs.agents ?? []).filter(a => a !== gs.player);
    for (const a of agents.slice(0, 6)) {
      const nr = a.navRuntime;
      let desc = nr?.path?.length
        ? `has path (${nr.path.length} wps)`
        : 'no path';
      const other = agents.find(o => o !== a && !o.dead);
      if (other) {
        try {
          const p = nm.findPath(a.position.clone(), other.position.clone());
          desc += ` | to ${other.name}: ${Array.isArray(p) ? p.length : 'null'} waypoints`;
        } catch (e) { desc += ` | path threw: ${e.message}`; }
      }
      line(`${String(a.name).padEnd(10)} @ ${v3(a.position)} → ${desc}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────
  group('8. Position-vs-obstacle cross-check', () => {
    const agents = (gs.agents ?? []).filter(a => a !== gs.player);
    const cols = gs.arenaColliders ?? [];
    if (cols.length === 0) { line('No arenaColliders (cannot test).'); return; }
    let insideAny = false;
    for (const a of agents) {
      const hits = [];
      for (const c of cols) {
        if (c.type === 'box') {
          if (Math.abs(a.position.x - c.x) < c.hw && Math.abs(a.position.z - c.z) < c.hd) hits.push(c);
        } else if (c.type === 'circle') {
          if (Math.hypot(a.position.x - c.x, a.position.z - c.z) < c.r) hits.push(c);
        }
      }
      if (hits.length) {
        line(`  ❌ ${a.name} @ ${v3(a.position)} is INSIDE ${hits.length} collider(s)`);
        insideAny = true;
      }
    }
    if (!insideAny) line('No agents found inside colliders.');
  });

  // ───────────────────────────────────────────────────────────────────
  group('9. Goal / brain state', () => {
    const agents = (gs.agents ?? []).filter(a => a !== gs.player);
    for (const a of agents.slice(0, 6)) {
      const brain = a.brain;
      const sub = brain?.subgoals?.();
      line(`  ${a.name}: brain=${brain?.constructor?.name} | subgoals=${sub?.map(g => g.constructor.name).join(' > ') || 'none'}`);
    }
  });

  // ───────────────────────────────────────────────────────────────────
  group('10. Summary / likely failure mode', () => {
    const colCount = gs.arenaColliders?.length ?? 0;
    const compCount = nmm.components?.length ?? 0;
    const mainSize = nmm.mainComponent?.size ?? 0;
    const totalRegions = nm?.regions?.length ?? 0;
    const problems = [];
    if (!nm) problems.push('• No navmesh loaded at all.');
    if (totalRegions && totalRegions < 200) problems.push(`• Only ${totalRegions} regions — baked navmesh probably not loaded.`);
    if (compCount > 1 && mainSize / totalRegions < 0.5) problems.push(`• Main component is only ${mainSize}/${totalRegions} — baked mesh is heavily fragmented.`);
    if (colCount === 0 && totalRegions < 2000) problems.push('• arenaColliders empty AND navmesh sparse → bots will walk through walls.');
    const agentsOff = gs.agents.filter(a => a.navRuntime && !a.navRuntime.currentRegion).length;
    if (agentsOff) problems.push(`• ${agentsOff} agent(s) have NO currentRegion.`);

    if (problems.length === 0) line('✓ No obvious structural problems detected.');
    else problems.forEach(p => line(p));
  });

  console.log('%c═══ End dump ═══', 'color:#57a0ff;font-size:14px;font-weight:bold');
  line('\n--- End of Report ---', false);

  // Trigger Download
  try {
    const blob = new Blob([report], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debugReport_${new Date().getTime()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log('%c✅ debugReport.md produced and download triggered!', 'color:#40f5a2;font-weight:bold');
  } catch (e) {
    console.error('Failed to trigger download:', e);
    console.log('--- REPORT CONTENT START ---');
    console.log(report);
    console.log('--- REPORT CONTENT END ---');
  }
})();