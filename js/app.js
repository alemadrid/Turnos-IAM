// ============================================================
// app.js — Planificador de Turnos v2.1
// Contraseña admin: Diosacibeles2026!
// Fixes: hash correcto, shortName desambiguado, vacaciones
//        operativas sin admin check previo erróneo,
//        perfiles NUNCA visibles, generar solo en admin.
// ============================================================

window.APP = {
  config:      null,
  users:       [],
  holidays:    {},
  schedule:    {},
  vacations:   {},
  auditTrail:  [],
  isAdmin:     false,
  currentView: 'dashboard'
};

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async function() {
  showLoadingOverlay(true);
  try {
    await loadStaticData();
    loadOperationalData();
    renderApp();
    setupNavigation();
    showLoadingOverlay(false);
    window.showToast('Sistema cargado correctamente.', 'success', 2500);
  } catch (err) {
    showLoadingOverlay(false);
    document.getElementById('app-root').innerHTML =
      `<div class="fatal-error"><h2>Error de inicialización</h2><p>${err.message}</p>
       <button onclick="location.reload()">Reintentar</button></div>`;
    console.error('Init error:', err);
  }
});

// Antídoto #1: cache-busting. Antídoto #2: NUNCA guardar config en localStorage.
async function loadStaticData() {
  const ts = Date.now();
  const [cfgRes, usersRes, holidaysRes] = await Promise.all([
    fetch(`data/config.json?v=${ts}`),
    fetch(`data/users.json?v=${ts}`),
    fetch(`data/holidays.json?v=${ts}`)
  ]);
  if (!cfgRes.ok)      throw new Error('No se pudo cargar config.json');
  if (!usersRes.ok)    throw new Error('No se pudo cargar users.json');
  if (!holidaysRes.ok) throw new Error('No se pudo cargar holidays.json');
  APP.config   = await cfgRes.json();
  APP.users    = await usersRes.json();
  APP.holidays = await holidaysRes.json();
}

function loadOperationalData() {
  APP.schedule   = window.loadScheduleLocal();
  APP.vacations  = window.loadVacationsLocal();
  APP.auditTrail = window.loadAuditTrail();
}

// ─── Navegación ──────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', function() { navigateTo(this.dataset.nav); });
  });
}

window.navigateTo = function(view) {
  APP.currentView = view;
  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.classList.toggle('nav-active', btn.dataset.nav === view);
  });
  renderApp();
};

function renderApp() {
  const root = document.getElementById('app-root');
  if (!root) return;
  switch (APP.currentView) {
    case 'dashboard':  root.innerHTML = renderDashboard();      break;
    case 'schedule':   root.innerHTML = renderScheduleView();   break;
    case 'vacations':  root.innerHTML = renderVacationsView();  break;
    case 'report':     root.innerHTML = renderReportView();     break;
    case 'settings':   root.innerHTML = renderSettingsView();   break;
    default:           root.innerHTML = renderDashboard();
  }
  requestAnimationFrame(setupTooltips);
}

// ─── Helpers UI ──────────────────────────────────────────────
function userName(id) {
  const u = APP.users.find(u => u.id === id);
  return u ? u.name : String(id);
}

// Nombre corto desambiguado: añade iniciales de apellidos hasta ser único.
// Ej: 3 Alejandros → "Alejandro G.T." / "Alejandro G.V." / "Alejandro L."
function shortName(id) {
  const u = APP.users.find(u => u.id === id);
  if (!u) return String(id);
  const parts = u.name.trim().split(/\s+/);
  const first = parts[0];
  const sameFirst = APP.users.filter(x => x.name.trim().split(/\s+/)[0] === first);

  if (sameFirst.length === 1) {
    return parts.length >= 2 ? `${first} ${parts[1][0]}.` : first;
  }
  // Colisión: añadir iniciales de apellidos progresivamente
  for (let depth = 1; depth < parts.length; depth++) {
    const suffix    = parts.slice(1, depth + 1).map(p => p[0] + '.').join('');
    const candidate = `${first} ${suffix}`;
    const conflict  = sameFirst.filter(x => {
      const xp = x.name.trim().split(/\s+/);
      const xs = xp.slice(1, depth + 1).map(p => p[0] + '.').join('');
      return `${xp[0]} ${xs}` === candidate && x.id !== id;
    });
    if (conflict.length === 0) return candidate;
  }
  return u.name;
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

// ─── Tooltip global ──────────────────────────────────────────
function setupTooltips() {
  const tip = document.getElementById('global-tooltip');
  if (!tip) return;
  document.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mouseenter', function(e) {
      tip.innerHTML = this.dataset.tip.replace(/\\n/g, '<br>').replace(/&#10;/g, '<br>');
      tip.classList.add('tip-visible');
      positionTip(e, tip);
    });
    el.addEventListener('mousemove', function(e) { positionTip(e, tip); });
    el.addEventListener('mouseleave', function() { tip.classList.remove('tip-visible'); });
  });
}

function positionTip(e, tip) {
  const x = e.clientX + 14, y = e.clientY + 18;
  const vw = window.innerWidth, tipW = 240;
  tip.style.left = (x + tipW > vw ? x - tipW - 20 : x) + 'px';
  tip.style.top  = y + 'px';
}

// ─── DASHBOARD ───────────────────────────────────────────────
function renderDashboard() {
  const today      = window.formatDateLocal(new Date());
  const todayData  = APP.schedule[today] || null;
  const totalDays  = Object.keys(APP.schedule).length;
  const vacEntries = Object.values(APP.vacations).flat().length;
  const onVacToday = APP.users.filter(u => window.isOnVacation(u.id, today, APP.vacations));
  const holType    = window.getHolidayType ? window.getHolidayType(today, APP.holidays) : null;
  const holName    = window.getHolidayName(today, APP.holidays);
  const closedToday = todayData && todayData.closed;
  const dow         = new Date().getDay();
  const isWeekend   = (dow === 0 || dow === 6);

  let todayCard = '';
  if (isWeekend) {
    todayCard = `<div class="today-card closed"><div class="closed-icon">📅</div><div class="closed-text">Fin de semana — sin servicio</div></div>`;
  } else if (closedToday) {
    todayCard = `<div class="today-card closed"><div class="closed-icon">🔒</div><div class="closed-text">Servicio cerrado — ${holName || 'Festivo'}</div></div>`;
  } else if (todayData) {
    const mNames = (todayData.morning   || []).map(id => userName(id));
    const aNames = (todayData.afternoon || []).map(id => userName(id));
    const badge  = holType ? `<span class="hol-badge hol-${holType}">${holName}</span>` : '';
    todayCard = `
      <div class="today-card">
        ${badge}
        <div class="shift-row">
          <div class="shift-label morning-label"><span class="shift-icon">☀</span><span>Mañana <span class="shift-time">08:00–17:00</span></span></div>
          <div class="tech-chips">${mNames.map(n => `<span class="chip">${n}</span>`).join('') || '<span class="chip empty">Sin asignar</span>'}</div>
        </div>
        <div class="shift-row">
          <div class="shift-label afternoon-label"><span class="shift-icon">🌙</span><span>Tarde <span class="shift-time">15:00–24:00</span></span></div>
          <div class="tech-chips">${aNames.map(n => `<span class="chip chip-afternoon">${n}</span>`).join('') || '<span class="chip empty">Sin asignar</span>'}</div>
        </div>
      </div>`;
  } else {
    todayCard = `<div class="today-card empty-state"><p>Sin cuadrante generado para hoy.</p><button class="btn-primary" onclick="navigateTo('schedule')">Ir al Planificador</button></div>`;
  }

  // Equipo: sin perfil, sin estrella
  const teamGrid = APP.users.map(u => {
    const onVac  = window.isOnVacation(u.id, today, APP.vacations);
    const used   = window.getVacationDaysUsed(u.id, APP.vacations);
    const pct    = Math.min(100, Math.round((used / u.vacationDaysTotal) * 100));
    const status = onVac ? 'vacation' : (closedToday ? 'holiday' : 'working');
    const nextVac = (APP.vacations[u.id] || [])
      .filter(v => window.parseLocalDate(v.end) >= new Date())
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    const vacTip  = nextVac ? `Próximas vacaciones:\n${nextVac.start} → ${nextVac.end}` : 'Sin vacaciones próximas';
    const statusEl = onVac
      ? `<span class="status-badge status-vacation" data-tip="${vacTip}">🏖 Vacaciones</span>`
      : `<span class="status-badge status-${status}">${status === 'working' ? '✓ Activo' : '🔒 Festivo'}</span>`;
    return `
      <div class="team-member ${status}">
        <div class="member-avatar av-${status}">${initials(u.name)}</div>
        <div class="member-info">
          <div class="member-name">${u.name}</div>
          <div class="vac-bar-wrap"><div class="vac-bar" style="width:${pct}%"></div></div>
          <div class="vac-label">${used}/${u.vacationDaysTotal} días vacaciones</div>
        </div>
        <div class="member-status-col">${statusEl}</div>
      </div>`;
  }).join('');

  return `
    <div class="view-header">
      <h1 class="view-title">Dashboard</h1>
      <p class="view-sub">Visión general del equipo IT — ${today}</p>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon">📅</div><div class="stat-value">${totalDays}</div><div class="stat-label">Días planificados</div></div>
      <div class="stat-card"><div class="stat-icon">👥</div><div class="stat-value">${APP.users.length}</div><div class="stat-label">Técnicos activos</div></div>
      <div class="stat-card"><div class="stat-icon">🌴</div><div class="stat-value">${vacEntries}</div><div class="stat-label">Periodos vacacionales</div></div>
      <div class="stat-card ${onVacToday.length > 0 ? 'stat-warning' : ''}"><div class="stat-icon">🏖</div><div class="stat-value">${onVacToday.length}</div><div class="stat-label">De vacaciones hoy</div></div>
    </div>
    <section class="section-card">
      <h2 class="section-title">Cuadrante de Hoy</h2>${todayCard}
    </section>
    <section class="section-card">
      <h2 class="section-title">Estado del Equipo</h2>
      <div class="team-grid">${teamGrid}</div>
    </section>`;
}

// ─── SCHEDULE VIEW ───────────────────────────────────────────
function renderScheduleView() {
  const today = new Date();
  const genBtn = APP.isAdmin
    ? `<button class="btn-primary" onclick="openGeneratorRangeModal()">⚡ Generar Cuadrante Automático</button>`
    : `<button class="btn-disabled" title="Requiere modo Administrador" disabled>🔒 Generar Cuadrante</button>`;

  return `
    <div class="view-header">
      <h1 class="view-title">Planificador de Cuadrantes</h1>
      <p class="view-sub">Edición y generación requieren modo Administrador</p>
    </div>
    <div class="toolbar">
      ${genBtn}
      <button class="btn-secondary" onclick="window.exportScheduleCSV(APP.schedule, APP.users)">⬇ Exportar CSV</button>
    </div>
    <div class="month-navigator">
      <button class="nav-arrow" onclick="changeScheduleMonth(-1)">◀</button>
      <span id="schedule-month-label" class="month-label">Cargando...</span>
      <button class="nav-arrow" onclick="changeScheduleMonth(1)">▶</button>
    </div>
    <div id="schedule-calendar-wrap">${renderCalendar(today.getFullYear(), today.getMonth())}</div>
    <div id="modal-generator" class="modal hidden">
      <div class="modal-backdrop" onclick="closeGeneratorModal()"></div>
      <div class="modal-box">
        <h3 class="modal-title">Generar Cuadrante Automático</h3>
        <p class="modal-desc">Solo días laborables lun–vie. Festivos aplicados por categoría.</p>
        <div class="form-row"><label>Fecha Inicio</label><input type="date" id="gen-start" value="2026-01-01"></div>
        <div class="form-row"><label>Fecha Fin</label><input type="date" id="gen-end" value="2026-12-31"></div>
        <div class="form-row checkbox-row">
          <input type="checkbox" id="gen-overwrite">
          <label for="gen-overwrite">Sobreescribir cuadrante existente</label>
        </div>
        <div class="modal-actions">
          <button class="btn-ghost" onclick="closeGeneratorModal()">Cancelar</button>
          <button class="btn-primary" onclick="executeAutoGenerate()">Generar</button>
        </div>
      </div>
    </div>
    <div id="modal-edit-day" class="modal hidden">
      <div class="modal-backdrop" onclick="closeEditDayModal()"></div>
      <div class="modal-box" id="edit-day-content"></div>
    </div>`;
}

window._scheduleMonth = new Date().getMonth();
window._scheduleYear  = new Date().getFullYear();

window.changeScheduleMonth = function(delta) {
  window._scheduleMonth += delta;
  if (window._scheduleMonth < 0)  { window._scheduleMonth = 11; window._scheduleYear--; }
  if (window._scheduleMonth > 11) { window._scheduleMonth = 0;  window._scheduleYear++; }
  const wrap = document.getElementById('schedule-calendar-wrap');
  if (wrap) wrap.innerHTML = renderCalendar(window._scheduleYear, window._scheduleMonth);
  const lbl = document.getElementById('schedule-month-label');
  if (lbl) lbl.textContent = `${window.monthName(window._scheduleMonth)} ${window._scheduleYear}`;
  requestAnimationFrame(setupTooltips);
};

function renderCalendar(year, month) {
  const lbl = document.getElementById('schedule-month-label');
  if (lbl) lbl.textContent = `${window.monthName(month)} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  let startDow   = firstDay.getDay();
  if (startDow === 0) startDow = 7;
  startDow -= 1;

  let html = `<div class="calendar-grid">
    <div class="cal-header-row">
      ${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((d,i) =>
        `<div class="cal-head ${i>=5?'cal-head-wknd':''}">${d}</div>`).join('')}
    </div><div class="cal-body">`;

  for (let i = 0; i < startDow; i++) html += `<div class="cal-cell empty"></div>`;

  for (let d = 1; d <= lastDay.getDate(); d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayData = APP.schedule[dateStr];
    const holType = window.getHolidayType(dateStr, APP.holidays);
    const holName = window.getHolidayName(dateStr, APP.holidays);
    const isToday = dateStr === window.formatDateLocal(new Date());
    const dow     = window.parseLocalDate(dateStr).getDay();
    const isWknd  = (dow === 0 || dow === 6);

    let cellClass = 'cal-cell';
    if (isWknd)                  cellClass += ' cell-weekend';
    else if (holType==='closure')  cellClass += ' cell-closure';
    else if (holType==='national') cellClass += ' cell-national';
    else if (holType==='alicante') cellClass += ' cell-alicante';
    if (isToday)                 cellClass += ' cell-today';

    let content = '';
    if (isWknd) {
      content = '';
    } else if (holType === 'closure') {
      content = `<div class="cell-hol-row"><span class="cell-hol-ico">🔒</span><span class="cell-hol-name">${holName}</span></div>`;
    } else if (dayData) {
      const mIds = dayData.morning   || [];
      const aIds = dayData.afternoon || [];
      const vacUsers  = APP.users.filter(u => window.isOnVacation(u.id, dateStr, APP.vacations));
      const mAllNames = mIds.map(id => userName(id)).join('&#10;') || 'Sin asignar';
      const aAllNames = aIds.map(id => userName(id)).join('&#10;') || 'Sin asignar';
      const holBadge  = holType ? `<span class="cell-hol-tag hol-${holType}" data-tip="${holName}">${holType==='alicante'?'🎆':'🇪🇸'}</span>` : '';
      const vacBadge  = vacUsers.length > 0
        ? `<span class="cell-vac-ico" data-tip="De vacaciones:&#10;${vacUsers.map(u=>u.name).join('&#10;')}">🏖${vacUsers.length}</span>` : '';
      const warnBadge = (mIds.length < 2 || aIds.length < 2)
        ? `<span class="cell-warn" data-tip="Cobertura insuficiente">⚠</span>` : '';
      const mList = mIds.map(id =>
        `<div class="cell-tech morning-tech" data-tip="${userName(id)}">${shortName(id)}</div>`).join('');
      const aList = aIds.map(id =>
        `<div class="cell-tech afternoon-tech" data-tip="${userName(id)}">${shortName(id)}</div>`).join('');
      content = `
        <div class="cell-meta-row">${holBadge}${vacBadge}${warnBadge}</div>
        <div class="cell-shift-block">
          <div class="cell-shift-hdr morning-hdr" data-tip="☀ Mañana (08-17):&#10;${mAllNames}">☀ <span class="cell-shift-count">${mIds.length}</span></div>
          ${mList}
        </div>
        <div class="cell-shift-block">
          <div class="cell-shift-hdr afternoon-hdr" data-tip="🌙 Tarde (15-24):&#10;${aAllNames}">🌙 <span class="cell-shift-count">${aIds.length}</span></div>
          ${aList}
        </div>`;
    } else {
      content = `<div class="cell-no-data">Sin datos</div>`;
    }

    const clickFn = (!isWknd && holType !== 'closure')
      ? `onclick="openEditDayModal('${dateStr}')"`
      : '';
    html += `<div class="${cellClass}" ${clickFn}><div class="cell-day-num">${d}</div>${content}</div>`;
  }
  html += `</div></div>`;
  return html;
}

window.openGeneratorRangeModal = function() {
  if (!APP.isAdmin) { window.showToast('🔒 Requiere modo Administrador.', 'warning'); return; }
  document.getElementById('modal-generator').classList.remove('hidden');
};
window.closeGeneratorModal = function() {
  document.getElementById('modal-generator').classList.add('hidden');
};
window.executeAutoGenerate = function() {
  if (!APP.isAdmin) { window.showToast('🔒 Acceso denegado.', 'error'); return; }
  const startStr  = document.getElementById('gen-start').value;
  const endStr    = document.getElementById('gen-end').value;
  const overwrite = document.getElementById('gen-overwrite').checked;
  if (!startStr || !endStr) { window.showToast('Indica fechas de inicio y fin.', 'warning'); return; }
  const weeks = window.getWeeksInRange(startStr, endStr);
  if (weeks.length === 0) { window.showToast('Rango inválido.', 'error'); return; }
  const { schedule, contingencies } = window.generateSchedule(weeks, APP.users, APP.vacations, APP.holidays, APP.config);
  if (overwrite) APP.schedule = schedule;
  else Object.assign(APP.schedule, schedule);
  window.saveScheduleLocal(APP.schedule);
  window.appendAuditEntry('AUTO_GENERATE', `${startStr}→${endStr}`, 'all', null, null, 'Admin');
  closeGeneratorModal();
  const n = Object.keys(schedule).length;
  let msg = `✅ Cuadrante generado: ${n} días laborables.`;
  if (contingencies.length > 0) {
    msg += `\n\n⚠ ${contingencies.length} semanas con ajuste:\n\n` + contingencies.join('\n');
    alert(msg);
  } else {
    window.showToast(msg, 'success', 4000);
  }
  renderApp();
};

window.openEditDayModal = function(dateStr) {
  if (!APP.isAdmin) { window.showToast('🔒 Activa el modo Administrador para editar.', 'warning'); return; }
  const dayData = APP.schedule[dateStr] || { morning:[], afternoon:[], closed:false };
  const d = window.parseLocalDate(dateStr);
  const title = `${window.dayNameFull(d.getDay())} ${d.getDate()} ${window.monthName(d.getMonth())} ${d.getFullYear()}`;
  const checks = (shift) => APP.users.map(u => {
    const on = (dayData[shift]||[]).includes(u.id) ? 'checked' : '';
    return `<label class="check-label"><input type="checkbox" data-uid="${u.id}" data-shift="${shift}" ${on}><span class="check-tech">${u.name}</span></label>`;
  }).join('');
  document.getElementById('edit-day-content').innerHTML = `
    <h3 class="modal-title">Editar: ${title}</h3>
    <div class="form-row checkbox-row">
      <input type="checkbox" id="day-closed" ${dayData.closed?'checked':''}
             onchange="document.getElementById('shift-editor').style.display=this.checked?'none':''">
      <label for="day-closed">🔒 Cierre de servicio</label>
    </div>
    <div id="shift-editor" ${dayData.closed?'style="display:none"':''}>
      <div class="shift-editor-col"><h4>☀ Mañana</h4><div class="checkboxes-list">${checks('morning')}</div></div>
      <div class="shift-editor-col"><h4>🌙 Tarde</h4><div class="checkboxes-list">${checks('afternoon')}</div></div>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeEditDayModal()">Cerrar</button>
      <button class="btn-primary" onclick="saveDayEdits('${dateStr}')">Guardar</button>
    </div>`;
  document.getElementById('modal-edit-day').classList.remove('hidden');
};
window.saveDayEdits = function(dateStr) {
  const isClosed = document.getElementById('day-closed').checked;
  if (isClosed) {
    APP.schedule[dateStr] = { morning:[], afternoon:[], closed:true, holidayType:'closure', holiday:'Manual' };
  } else {
    const mIds=[], aIds=[];
    document.querySelectorAll('[data-shift="morning"]:checked').forEach(cb => mIds.push(parseInt(cb.dataset.uid)));
    document.querySelectorAll('[data-shift="afternoon"]:checked').forEach(cb => aIds.push(parseInt(cb.dataset.uid)));
    APP.schedule[dateStr] = { morning:mIds, afternoon:aIds, closed:false,
      holidayType: window.getHolidayType ? window.getHolidayType(dateStr, APP.holidays) : null,
      holiday: window.getHolidayName(dateStr, APP.holidays) };
  }
  window.saveScheduleLocal(APP.schedule);
  window.appendAuditEntry('MANUAL_EDIT', dateStr, 'all', null, null, 'Admin');
  closeEditDayModal();
  const wrap = document.getElementById('schedule-calendar-wrap');
  if (wrap) { wrap.innerHTML = renderCalendar(window._scheduleYear, window._scheduleMonth); requestAnimationFrame(setupTooltips); }
  window.showToast(`Guardado: ${dateStr}`, 'success');
};
window.closeEditDayModal = function() { document.getElementById('modal-edit-day').classList.add('hidden'); };

// ─── VACATIONS VIEW ──────────────────────────────────────────
// El botón "+ Añadir" solo se muestra en admin.
// El MODAL de añadir vacaciones funciona siempre que el botón se pulse.
function renderVacationsView() {
  const rows = APP.users.map(u => {
    const vacs = APP.vacations[u.id] || [];
    const used = window.getVacationDaysUsed(u.id, APP.vacations);
    const pct  = Math.min(100, Math.round((used / u.vacationDaysTotal) * 100));
    const vacList = vacs.length === 0
      ? '<p class="empty-vac">Sin periodos registrados.</p>'
      : vacs.map((v, i) => {
          const days = Math.round((window.parseLocalDate(v.end) - window.parseLocalDate(v.start)) / 86400000) + 1;
          return `<div class="vac-entry">
            <span class="vac-range">📅 ${v.start} → ${v.end}</span>
            <span class="vac-days">${days} días</span>
            ${APP.isAdmin ? `<button class="btn-del" onclick="deleteVacation(${u.id},${i})">✕</button>` : ''}
          </div>`;
        }).join('');
    return `
      <div class="vac-user-block">
        <div class="vac-user-header">
          <div class="member-avatar av-working">${initials(u.name)}</div>
          <div style="flex:1">
            <div class="member-name">${u.name}</div>
            <div class="vac-bar-wrap wide"><div class="vac-bar" style="width:${pct}%"></div></div>
            <div class="vac-label">${used} / ${u.vacationDaysTotal} días (${pct}%)</div>
          </div>
          ${APP.isAdmin
            ? `<button class="btn-add" onclick="openAddVacModal(${u.id})">+ Añadir</button>`
            : ''}
        </div>
        <div class="vac-list">${vacList}</div>
      </div>`;
  }).join('');

  return `
    <div class="view-header">
      <h1 class="view-title">Gestión de Vacaciones</h1>
      <p class="view-sub">Registro y validación de periodos vacacionales 2026</p>
    </div>
    <div class="info-banner">
      ℹ️ <strong>Recomendación 2026:</strong> Para vacaciones desde el <strong>15 de julio</strong> se recomienda usar semanas completas (lun–dom, mínimo 7 días). Si el periodo no cumple esta recomendación, el sistema pedirá confirmación antes de guardar.
      ${!APP.isAdmin ? '<br><span style="opacity:.7">Activa el modo Administrador para añadir o eliminar periodos.</span>' : ''}
    </div>
    <div class="vac-users-list">${rows}</div>
    <div id="modal-add-vac" class="modal hidden">
      <div class="modal-backdrop" onclick="closeAddVacModal()"></div>
      <div class="modal-box" id="add-vac-content"></div>
    </div>`;
}

window.openAddVacModal = function(userId) {
  if (!APP.isAdmin) { window.showToast('🔒 Requiere modo Administrador.', 'warning'); return; }
  const user = APP.users.find(u => u.id === userId);
  if (!user) return;
  // El modal se inserta directamente en el DOM — siempre presente en vacationsView
  const box = document.getElementById('add-vac-content');
  if (!box) { window.showToast('Error: recarga la página.', 'error'); return; }
  box.innerHTML = `
    <h3 class="modal-title">Añadir Vacaciones</h3>
    <p class="modal-desc" style="color:var(--accent);font-weight:600">${user.name}</p>
    <div class="form-row">
      <label>Fecha Inicio</label>
      <input type="date" id="vac-start" min="2026-01-01" max="2026-12-31">
    </div>
    <div class="form-row">
      <label>Fecha Fin</label>
      <input type="date" id="vac-end" min="2026-01-01" max="2026-12-31">
    </div>
    <div id="vac-validation-msg" style="display:none;padding:8px 12px;border-radius:6px;font-size:.82rem;margin:8px 0;background:var(--red-dim);color:var(--red);border:1px solid var(--red)"></div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeAddVacModal()">Cancelar</button>
      <button class="btn-primary" onclick="saveVacation(${userId})">Guardar</button>
    </div>`;
  document.getElementById('modal-add-vac').classList.remove('hidden');
  // Focus en fecha inicio
  setTimeout(() => { const i = document.getElementById('vac-start'); if(i) i.focus(); }, 100);
};

window.closeAddVacModal = function() {
  const m = document.getElementById('modal-add-vac');
  if (m) m.classList.add('hidden');
};

window.saveVacation = function(userId) {
  const startEl = document.getElementById('vac-start');
  const endEl   = document.getElementById('vac-end');
  const msgEl   = document.getElementById('vac-validation-msg');
  if (!startEl || !endEl) { window.showToast('Error en el formulario.', 'error'); return; }
  const startStr = startEl.value;
  const endStr   = endEl.value;

  const result = window.validateVacationRequest(startStr, endStr, userId, APP.vacations);

  // Error duro: mostrar mensaje en el modal, no guardar
  if (!result.valid) {
    msgEl.textContent   = result.message;
    msgEl.style.display = 'block';
    return;
  }

  // Aviso suave: pedir confirmación fuera del modal
  if (result.warn) {
    msgEl.style.display = 'none';
    if (!confirm(result.message)) return; // usuario cancela → no guardar
  } else {
    msgEl.style.display = 'none';
  }

  // Guardar
  if (!APP.vacations[userId]) APP.vacations[userId] = [];
  APP.vacations[userId].push({ start: startStr, end: endStr });
  APP.vacations[userId].sort((a, b) => a.start.localeCompare(b.start));
  window.saveVacationsLocal(APP.vacations);
  const uName = APP.users.find(u => u.id === userId)?.name || userId;
  window.appendAuditEntry('ADD_VACATION', `${startStr}→${endStr}`, '-', userId, uName, 'Admin');
  closeAddVacModal();
  renderApp();
  window.showToast(`Vacaciones añadidas para ${uName}.`, 'success');
};

window.deleteVacation = function(userId, index) {
  if (!confirm('¿Eliminar este periodo vacacional?')) return;
  APP.vacations[userId].splice(index, 1);
  window.saveVacationsLocal(APP.vacations);
  renderApp();
  window.showToast('Periodo eliminado.', 'warning');
};

// ─── REPORT VIEW ─────────────────────────────────────────────
function renderReportView() {
  const equity  = window.generateEquityReport(APP.users, APP.schedule, APP.vacations, APP.holidays);
  const monthly = window.generateMonthlySummary(APP.schedule, APP.users, APP.holidays, 2026);
  const LIMIT = 1782;
  const eRows = equity.map(m => {
    const diff    = m.totalHours - LIMIT;
    const pct     = Math.min(100, Math.round((m.totalHours / LIMIT) * 100));
    const hClass  = m.hoursStatus === 'over' ? 'hours-over' : m.hoursStatus === 'warning' ? 'hours-warning' : 'hours-ok';
    const diffEl  = diff > 0
      ? `<span class="hours-diff-over">+${diff}h</span>`
      : diff < 0 ? `<span class="hours-diff-under">${diff}h</span>`
      : `<span class="hours-diff-ok">±0h</span>`;
    return `<tr>
      <td>${m.name}</td>
      <td class="num">${m.morningDays}</td>
      <td class="num">${m.afternoonDays}</td>
      <td class="num">${m.vacationDays}</td>
      <td class="num">${m.totalWorked}</td>
      <td>
        <div class="hours-cell">
          <div class="hours-bar-wrap">
            <div class="hours-bar ${hClass}-bar" style="width:${pct}%"></div>
            <div class="hours-limit-mark" title="Límite 1782h"></div>
          </div>
          <div class="hours-nums">
            <span class="hours-val ${hClass}">${m.totalHours}h</span>
            ${diffEl}
          </div>
        </div>
      </td>
      <td class="num"><div class="score-bar-wrap"><div class="score-bar" style="width:${m.equityScore}%"></div><span>${m.equityScore}%</span></div></td>
    </tr>`;
  }).join('');
  const mRows = monthly.map(m => `<tr>
    <td>${m.month}</td><td class="num">${m.totalDays}</td><td class="num">${m.closedDays}</td>
    <td class="num ${m.understaffedDays>0?'warn':''}">${m.understaffedDays}</td>
    <td class="num">${m.avgMorningCoverage}</td><td class="num">${m.avgAfternoonCoverage}</td>
  </tr>`).join('');
  return `
    <div class="view-header"><h1 class="view-title">Informes y Auditoría</h1><p class="view-sub">Métricas de equidad anual y trazabilidad</p></div>
    <div class="info-banner" style="background:rgba(79,142,247,.08);border-color:var(--accent);color:var(--text);margin-bottom:16px">
      ℹ Límite anual RRHH: <strong>1.782 horas</strong> por técnico (turnos de 9h). La barra muestra el porcentaje consumido; en rojo si se supera el límite.
    </div>
    <div class="toolbar">
      <button class="btn-primary" onclick="window.exportEquityReportCSV(APP.users,APP.schedule,APP.vacations,APP.holidays)">⬇ Exportar Equidad CSV</button>
      <button class="btn-secondary" onclick="window.exportScheduleCSV(APP.schedule,APP.users)">⬇ Exportar Cuadrante CSV</button>
    </div>
    <section class="section-card">
      <h2 class="section-title">Equidad y Horas por Técnico</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Técnico</th><th>Días Mañana</th><th>Días Tarde</th><th>Vacaciones</th><th>Total Días</th><th>Horas Anuales / 1782h</th><th>Score Equidad</th></tr></thead>
        <tbody>${eRows||'<tr><td colspan="7" class="empty-row">Sin datos. Genera el cuadrante primero.</td></tr>'}</tbody>
      </table></div>
    </section>
    <section class="section-card">
      <h2 class="section-title">Resumen Mensual</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Mes</th><th>Días</th><th>Cierres</th><th>Baja Cobertura</th><th>Cob. Mañana</th><th>Cob. Tarde</th></tr></thead>
        <tbody>${mRows}</tbody>
      </table></div>
    </section>
    <section class="section-card">
      <h2 class="section-title">Log de Auditoría</h2>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Timestamp</th><th>Acción</th><th>Fecha/Rango</th><th>Técnico</th><th>Por</th></tr></thead>
        <tbody>${APP.auditTrail.slice(-20).reverse().map(e=>`<tr>
          <td class="mono">${e.timestamp.replace('T',' ').slice(0,19)}</td>
          <td><span class="audit-tag">${e.action}</span></td>
          <td class="mono">${e.date||'-'}</td><td>${e.userName||'-'}</td><td>${e.performedBy||'-'}</td>
        </tr>`).join('')||'<tr><td colspan="5" class="empty-row">Sin registros.</td></tr>'}</tbody>
      </table></div>
    </section>`;
}

// ─── SETTINGS VIEW ───────────────────────────────────────────
function renderSettingsView() {
  return `
    <div class="view-header"><h1 class="view-title">Configuración y Datos</h1><p class="view-sub">Backup, restauración y ajustes</p></div>
    <section class="section-card">
      <h2 class="section-title">Backup de Datos</h2>
      <p class="section-desc">Exporta o restaura datos operativos. Las credenciales nunca se almacenan localmente.</p>
      <div class="toolbar">
        <button class="btn-primary" onclick="window.exportBackup()">⬇ Exportar Backup JSON</button>
        <label class="btn-secondary file-btn">⬆ Importar Backup<input type="file" accept=".json" onchange="handleImportBackup(event)" style="display:none"></label>
      </div>
    </section>
    <section class="section-card">
      <h2 class="section-title">Leyenda de Festivos</h2>
      <div class="legend-grid">
        <div class="legend-item"><span class="legend-dot dot-closure"></span>Cierre total (Año Nuevo, Navidad) — sin servicio</div>
        <div class="legend-item"><span class="legend-dot dot-national"></span>Festivo nacional — 2 mañana + 2 tarde</div>
        <div class="legend-item"><span class="legend-dot dot-alicante"></span>Festivo Alicante/CV — 4 mañana + 2 tarde</div>
        <div class="legend-item"><span class="legend-dot dot-normal"></span>Día normal lun–vie — equipo completo mañana / 2 tarde</div>
      </div>
    </section>
    <section class="section-card danger-zone">
      <h2 class="section-title">⚠ Zona de Peligro</h2>
      <p class="section-desc">Elimina todos los datos locales del navegador permanentemente.</p>
      <button class="btn-danger" onclick="confirmClearData()">🗑 Borrar Todos los Datos Locales</button>
    </section>
    <section class="section-card">
      <h2 class="section-title">Acerca de</h2>
      <div class="about-info">
        <p><strong>Planificador de Turnos</strong> v${APP.config?.version||'2.1.0'}</p>
        <p>Gestión de cuadrantes IT · Alicante 2026 · Sin backend · GitHub Pages</p>
      </div>
    </section>`;
}

window.handleImportBackup = function(e) {
  window.importBackup(e.target.files[0], function(schedule, vacations) {
    APP.schedule = schedule; APP.vacations = vacations; renderApp();
  });
};
window.confirmClearData = function() {
  if (confirm('⚠ ¿Eliminar TODOS los datos locales?')) {
    window.clearAllLocalData(); APP.schedule={}; APP.vacations={}; APP.auditTrail=[]; renderApp();
  }
};

// ─── ADMIN ───────────────────────────────────────────────────
window.toggleAdminMode = function() {
  if (APP.isAdmin) {
    APP.isAdmin = false;
    updateAdminUI();
    renderApp();
    window.showToast('Sesión de administrador cerrada.', 'info');
    return;
  }
  const modal = document.getElementById('modal-admin');
  if (modal) modal.classList.remove('hidden');
  const errMsg = document.getElementById('admin-error-msg');
  if (errMsg) errMsg.classList.add('hidden');
  const input = document.getElementById('admin-password-input');
  if (input) {
    input.value = '';
    input.focus();
    input.removeAttribute('onkeydown');
    input.removeEventListener('keydown', handleAdminKeydown);
    input.addEventListener('keydown', handleAdminKeydown);
  }
};

async function handleAdminKeydown(e) {
  if (e.key === 'Enter') {
    const val = e.target.value.trim();
    if (!val) return;
    await window.submitAdminPassword();
  }
}

window.submitAdminPassword = async function() {
  const input = document.getElementById('admin-password-input');
  const val   = input ? input.value.trim() : '';
  if (!val) { window.showToast('Introduce la contraseña.', 'warning'); return; }
  const hash = await window.sha256(val);
  if (input) input.value = '';
  const errMsg = document.getElementById('admin-error-msg');
  if (hash === APP.config.adminHash) {
    APP.isAdmin = true;
    const modal = document.getElementById('modal-admin');
    if (modal) modal.classList.add('hidden');
    if (errMsg) errMsg.classList.add('hidden');
    updateAdminUI();
    renderApp();
    window.showToast('✓ Acceso de administrador concedido.', 'success');
  } else {
    window.showToast('❌ Contraseña incorrecta.', 'error');
    if (errMsg) errMsg.classList.remove('hidden');
  }
};

window.closeAdminModal = function() {
  const modal = document.getElementById('modal-admin');
  if (modal) modal.classList.add('hidden');
};

function updateAdminUI() {
  const btn   = document.getElementById('admin-toggle-btn');
  const badge = document.getElementById('admin-badge');
  if (btn)   { btn.textContent = APP.isAdmin ? '🔓 Admin ON' : '🔐 Admin'; btn.classList.toggle('btn-admin-active', APP.isAdmin); }
  if (badge) { badge.style.display = APP.isAdmin ? 'flex' : 'none'; }
}

function showLoadingOverlay(v) {
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = v ? 'flex' : 'none';
}
