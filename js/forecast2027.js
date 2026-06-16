// ============================================================
// forecast2027.js — Previsión / simulación del año 2027
// MÓDULO AISLADO: NO modifica datos reales (APP.schedule,
// APP.vacations, etc.). Todo se calcula sobre estructuras
// propias guardadas en window._sim2027. Sirve para ver "la foto"
// de un año completo con turnos, vacaciones y horas.
// ============================================================

(function () {
  const YEAR = 2027;

  // ── Horas efectivas por turno (replica la lógica de report.js) ──
  function effFrom(s) {
    if (!s) return 8;
    if (s.effHours != null && s.effHours !== '') return +s.effHours;
    if (s.hours > 0) return s.hours - 1;
    return 8;
  }
  function shiftEff(shiftCfg, isFriday, slot) {
    if (isFriday && shiftCfg.friday && shiftCfg.friday[slot]) return effFrom(shiftCfg.friday[slot]);
    return effFrom(shiftCfg[slot]);
  }
  function shiftLabel(shiftCfg, isFriday, slot) {
    const s = (isFriday && shiftCfg.friday && shiftCfg.friday[slot]) ? shiftCfg.friday[slot] : shiftCfg[slot];
    return s ? `${s.start || '--'}–${s.end || '--'}` : '--';
  }

  // ── Festivos 2027: reutiliza día/mes de los festivos cargados ──
  function build2027Holidays() {
    const src = APP.holidays || {};
    const shift = (arr) => (arr || []).map(h => ({ name: h.name, date: `${YEAR}${String(h.date).slice(4)}` }));
    return { closure: shift(src.closure), national: shift(src.national), alicante: shift(src.alicante) };
  }

  // Cuenta días laborables (lun-vie) en un rango, excluyendo cierres.
  function countWorkingDays(startStr, endStr, holidays) {
    let n = 0;
    let d = window.parseLocalDate(startStr);
    const end = window.parseLocalDate(endStr);
    while (d <= end) {
      const dow = d.getDay();
      const ds  = window.formatDateLocal(d);
      const isClosure = (holidays.closure || []).some(h => h.date === ds);
      if (dow !== 0 && dow !== 6 && !isClosure) n++;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }
    return n;
  }

  // ── Vacaciones aleatorias: bloques de semana (lun-vie) por técnico ──
  function buildRandomVacations(users, holidays) {
    const vacations = {};
    users.forEach(u => {
      const target = u.vacationDaysTotal || 22;
      const ranges = [];
      const usedWeeks = new Set();
      let assignedWorking = 0;
      let guard = 0;
      while (assignedWorking < target && guard < 60) {
        guard++;
        // Semana aleatoria del año
        const week = 1 + Math.floor(Math.random() * 50);
        if (usedWeeks.has(week)) continue;
        usedWeeks.add(week);
        // Lunes de esa semana ISO aproximada: 1 ene + (week-1)*7, ajustado a lunes
        const jan1 = new Date(YEAR, 0, 1);
        const approx = new Date(YEAR, 0, 1 + (week - 1) * 7);
        const dow = approx.getDay();
        const toMon = dow === 0 ? 1 : (dow === 1 ? 0 : 8 - dow);
        const monday = new Date(approx.getFullYear(), approx.getMonth(), approx.getDate() + toMon);
        if (monday.getFullYear() !== YEAR) continue;
        const remaining = target - assignedWorking;
        // Bloque de 1..5 días laborables
        const blockLen = Math.max(1, Math.min(5, remaining, 2 + Math.floor(Math.random() * 4)));
        const friOffset = blockLen - 1;
        const end = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + friOffset);
        const startStr = window.formatDateLocal(monday);
        const endStr   = window.formatDateLocal(end);
        const wd = countWorkingDays(startStr, endStr, holidays);
        if (wd === 0) continue;
        ranges.push({ start: startStr, end: endStr });
        assignedWorking += wd;
      }
      ranges.sort((a, b) => a.start.localeCompare(b.start));
      vacations[u.id] = ranges;
    });
    return vacations;
  }

  // ── Genera la simulación completa del año ──
  window.buildForecast2027 = function () {
    const users = APP.users || [];
    if (!users.length) return null;

    const holidays  = build2027Holidays();
    const vacations = buildRandomVacations(users, holidays);
    const config    = APP.config || { algorithmWeights: { consecutiveAfternoonPenalty: 10, afternoonCountMonthlyLimit: 3, seniorStandardBonus: 5, vacationEquityWeight: 3 } };
    const shiftCfg  = APP.shifts || (config.shifts) ||
      { morning: { start: '08:00', end: '17:00', hours: 9 }, afternoon: { start: '15:00', end: '24:00', hours: 9 } };

    // Todas las semanas del año 2027
    const weeks = window.getWeeksInRange(`${YEAR}-01-01`, `${YEAR}-12-31`);
    const gen   = window.generateSchedule(weeks, users, vacations, holidays, config);
    const schedule = gen.schedule;

    // ── Resumen por técnico ──
    const maxHours = (window.getGeneralAnnualLimit ? window.getGeneralAnnualLimit() : 1782);
    const summary = users.map(u => ({
      id: u.id, name: u.name, profile: u.profile,
      morning: 0, afternoon: 0, total: 0,
      vacTotal: u.vacationDaysTotal || 0,
      vacAssigned: window.getVacationDaysUsed(u.id, vacations),
      vacWorkingDays: 0,
      maxHours, workedHours: 0, diff: 0, status: 'ok', equity: 0
    }));
    const byId = {};
    summary.forEach(s => byId[s.id] = s);

    Object.entries(schedule).forEach(([dateStr, day]) => {
      if (day.closed) return;
      const isFri = window.parseLocalDate(dateStr).getDay() === 5;
      (day.morning || []).forEach(uid => {
        const s = byId[uid]; if (!s) return;
        s.morning++; s.workedHours += shiftEff(shiftCfg, isFri, 'morning');
      });
      (day.afternoon || []).forEach(uid => {
        const s = byId[uid]; if (!s) return;
        s.afternoon++; s.workedHours += shiftEff(shiftCfg, isFri, 'afternoon');
      });
    });

    // Días laborables de vacaciones (excluye finde/cierres)
    summary.forEach(s => {
      (vacations[s.id] || []).forEach(r => {
        s.vacWorkingDays += countWorkingDays(r.start, r.end, holidays);
      });
    });

    summary.forEach(s => {
      s.total       = s.morning + s.afternoon;
      s.workedHours = Math.round(s.workedHours * 10) / 10;
      s.diff        = Math.round((s.workedHours - s.maxHours) * 10) / 10;
      const pct     = s.maxHours > 0 ? s.workedHours / s.maxHours : 0;
      s.status      = s.workedHours > s.maxHours ? 'over' : (pct >= 0.95 ? 'warning' : 'ok');
      const ratio   = s.total > 0 ? s.afternoon / s.total : 0;
      s.equity      = Math.max(0, 100 - Math.round(Math.abs(ratio - 0.25) * 200));
    });

    window._sim2027 = {
      schedule, vacations, holidays, shiftCfg, summary,
      month: 0, contingencies: gen.contingencies || []
    };
    return window._sim2027;
  };

  // ── Render del calendario mensual de la simulación ──
  function renderSimCalendar(month) {
    const sim = window._sim2027;
    if (!sim) return '<p>Sin datos de simulación.</p>';
    const { schedule, holidays, vacations, shiftCfg } = sim;

    const lastDay  = new Date(YEAR, month + 1, 0);
    let startDow   = new Date(YEAR, month, 1).getDay();
    if (startDow === 0) startDow = 7;
    startDow -= 1;

    let html = `<div class="calendar-grid">
      <div class="cal-header-row">
        ${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d,i) =>
          `<div class="cal-head ${i>=5?'cal-head-wknd':''}">${d}</div>`).join('')}
      </div><div class="cal-body">`;

    for (let i = 0; i < startDow; i++) html += `<div class="cal-cell empty"></div>`;

    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${YEAR}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayData = schedule[dateStr];
      const holType = window.getHolidayType(dateStr, holidays);
      const holName = window.getHolidayName(dateStr, holidays);
      const dow     = window.parseLocalDate(dateStr).getDay();
      const isWknd  = (dow === 0 || dow === 6);
      const isFri   = dow === 5;

      let cellClass = 'cal-cell';
      if (isWknd)                    cellClass += ' cell-weekend';
      else if (holType==='closure')  cellClass += ' cell-closure';
      else if (holType==='national') cellClass += ' cell-national';
      else if (holType==='alicante') cellClass += ' cell-alicante';

      let content = '';
      if (isWknd) {
        content = '';
      } else if (holType === 'closure') {
        content = `<div class="cell-hol-row"><span class="cell-hol-ico">🔒</span><span class="cell-hol-name">${holName}</span></div>`;
      } else if (dayData) {
        const mIds = dayData.morning   || [];
        const aIds = dayData.afternoon || [];
        const vacUsers  = (APP.users || []).filter(u => window.isOnVacation(u.id, dateStr, vacations));
        const mAllNames = mIds.map(id => uName(id)).join('&#10;') || 'Sin asignar';
        const aAllNames = aIds.map(id => uName(id)).join('&#10;') || 'Sin asignar';
        const holBadge  = holType ? `<span class="cell-hol-tag hol-${holType}" data-tip="${holName}">${holType==='alicante'?'🎆':'🇪🇸'}</span>` : '';
        const vacBadge  = vacUsers.length > 0
          ? `<span class="cell-vac-ico" data-tip="De vacaciones:&#10;${vacUsers.map(u=>u.name).join('&#10;')}">🏖${vacUsers.length}</span>` : '';
        const mList = mIds.map(id =>
          `<div class="cell-tech morning-tech" data-tip="${uName(id)}">${uShort(id)}</div>`).join('');
        const aList = aIds.map(id =>
          `<div class="cell-tech afternoon-tech" data-tip="${uName(id)}">${uShort(id)}</div>`).join('');
        content = `
          <div class="cell-meta-row">${holBadge}${vacBadge}</div>
          <div class="cell-shift-block">
            <div class="cell-shift-hdr morning-hdr" data-tip="☀ Mañana (${shiftLabel(shiftCfg, isFri, 'morning')}):&#10;${mAllNames}">☀ <span class="cell-shift-count">${mIds.length}</span></div>
            ${mList}
          </div>
          <div class="cell-shift-block">
            <div class="cell-shift-hdr afternoon-hdr" data-tip="🌙 Tarde (${shiftLabel(shiftCfg, isFri, 'afternoon')}):&#10;${aAllNames}">🌙 <span class="cell-shift-count">${aIds.length}</span></div>
            ${aList}
          </div>`;
      } else {
        content = `<div class="cell-no-data">—</div>`;
      }
      html += `<div class="${cellClass}"><div class="cell-day-num">${d}</div>${content}</div>`;
    }
    html += `</div></div>`;
    return html;
  }

  // Helpers de nombre (usan los del app si existen)
  function uName(id) {
    const u = (APP.users || []).find(x => x.id === id);
    return u ? u.name : String(id);
  }
  function uShort(id) {
    if (typeof window.shortNamePublic === 'function') return window.shortNamePublic(id);
    const u = (APP.users || []).find(x => x.id === id);
    if (!u) return String(id);
    const p = u.name.trim().split(/\s+/);
    return p.length >= 2 ? `${p[0]} ${p[1][0]}.` : p[0];
  }

  // ── Cambia el mes del calendario simulado ──
  window.sim2027ChangeMonth = function (month) {
    if (!window._sim2027) return;
    window._sim2027.month = parseInt(month);
    const wrap = document.getElementById('sim2027-calendar-wrap');
    if (wrap) { wrap.innerHTML = renderSimCalendar(window._sim2027.month); requestAnimationFrame(window.setupTooltips || (()=>{})); }
  };

  // ── Regenera la simulación (nuevas vacaciones aleatorias) ──
  window.sim2027Regenerate = function () {
    window.buildForecast2027();
    if (typeof window.renderApp === 'function') window.renderApp();
    window.showToast('🔮 Nueva simulación 2027 generada.', 'success');
  };

  // ── Vista principal de Previsión 2027 ──
  window.renderForecast2027 = function () {
    if (!window._sim2027) window.buildForecast2027();
    const sim = window._sim2027;
    if (!sim) return `<div class="view-header"><h1 class="view-title">Previsión 2027</h1></div><p>Carga los usuarios primero.</p>`;

    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const monthOpts = months.map((m, i) =>
      `<option value="${i}" ${i === sim.month ? 'selected' : ''}>${m} ${YEAR}</option>`).join('');

    // Tabla resumen
    const rows = sim.summary.map(s => {
      const hClass = s.status === 'over' ? 'hours-over' : s.status === 'warning' ? 'hours-warning' : 'hours-ok';
      const pct    = s.maxHours > 0 ? Math.min(100, Math.round((s.workedHours / s.maxHours) * 100)) : 0;
      const diffEl = s.diff > 0
        ? `<span class="hours-diff-over">+${s.diff}h</span>`
        : s.diff < 0 ? `<span class="hours-diff-under">${s.diff}h</span>`
        : `<span class="hours-diff-ok">±0h</span>`;
      const vacWarn = s.vacWorkingDays > s.vacTotal ? ' style="color:var(--orange)"' : '';
      return `<tr>
        <td>${s.name} <span style="font-size:.7rem;color:var(--text-muted)">${s.profile}</span></td>
        <td class="num">${s.morning}</td>
        <td class="num">${s.afternoon}</td>
        <td class="num">${s.total}</td>
        <td class="num">${s.vacTotal}</td>
        <td class="num"${vacWarn}>${s.vacWorkingDays}</td>
        <td class="num">${s.maxHours}h</td>
        <td>
          <div class="hours-cell">
            <div class="hours-bar-wrap">
              <div class="hours-bar ${hClass}-bar" style="width:${pct}%"></div>
              <div class="hours-limit-mark" title="Máximo: ${s.maxHours}h"></div>
            </div>
            <div class="hours-nums">
              <span class="hours-val ${hClass}">${s.workedHours}h</span>
              <span class="hours-prop">/ ${s.maxHours}h</span>
              ${diffEl}
            </div>
          </div>
        </td>
        <td class="num"><div class="score-bar-wrap"><div class="score-bar" style="width:${s.equity}%"></div><span>${s.equity}%</span></div></td>
      </tr>`;
    }).join('');

    // Totales agregados
    const totM   = sim.summary.reduce((a, s) => a + s.morning, 0);
    const totA   = sim.summary.reduce((a, s) => a + s.afternoon, 0);
    const totVac = sim.summary.reduce((a, s) => a + s.vacWorkingDays, 0);
    const overCount = sim.summary.filter(s => s.status === 'over').length;

    return `
      <div class="view-header">
        <h1 class="view-title">🔮 Previsión 2027</h1>
        <p class="view-sub">Simulación aislada — no afecta a los datos reales. Vacaciones asignadas de forma aleatoria.</p>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><div class="stat-icon">☀</div><div class="stat-value">${totM}</div><div class="stat-label">Turnos de mañana (año)</div></div>
        <div class="stat-card"><div class="stat-icon">🌙</div><div class="stat-value">${totA}</div><div class="stat-label">Turnos de tarde (año)</div></div>
        <div class="stat-card"><div class="stat-icon">🏖</div><div class="stat-value">${totVac}</div><div class="stat-label">Días vac. laborables asignados</div></div>
        <div class="stat-card ${overCount > 0 ? 'stat-warning' : ''}"><div class="stat-icon">⏱</div><div class="stat-value">${overCount}</div><div class="stat-label">Técnicos por encima del máximo</div></div>
      </div>

      <div class="toolbar" style="margin-bottom:8px">
        <button class="btn-secondary" onclick="window.sim2027Regenerate()">🎲 Regenerar simulación</button>
        <span style="font-size:.78rem;color:var(--text-muted);align-self:center">
          Usa los horarios configurados actualmente (mañana/tarde/viernes).
        </span>
      </div>

      <section class="section-card">
        <h2 class="section-title">📅 Calendario de turnos 2027</h2>
        <div class="month-navigator" style="justify-content:flex-start;gap:10px">
          <label style="font-size:.85rem;color:var(--text-muted)">Mes:</label>
          <select id="sim2027-month" onchange="window.sim2027ChangeMonth(this.value)"
                  style="background:var(--bg-4);border:1px solid var(--border);color:var(--text);padding:5px 10px;border-radius:6px;font-size:.9rem">
            ${monthOpts}
          </select>
        </div>
        <div id="sim2027-calendar-wrap">${renderSimCalendar(sim.month)}</div>
      </section>

      <section class="section-card">
        <h2 class="section-title">📊 Resumen por técnico (año completo)</h2>
        <p class="section-desc">
          Horas máximas = límite anual general (${sim.summary[0] ? sim.summary[0].maxHours : 1782}h, año completo).
          Horas efectivas = suma de turnos asignados según los horarios configurados.
          Un valor en rojo (+) indica que se pasaría del máximo anual.
        </p>
        <div class="table-wrap"><table class="data-table">
          <thead><tr>
            <th>Técnico</th><th>Mañanas</th><th>Tardes</th><th>Total turnos</th>
            <th>Días vac. totales</th><th>Días vac. asignados</th>
            <th>Horas máx.</th><th>Horas efectivas trabajadas</th><th>Score equidad</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  };
})();
