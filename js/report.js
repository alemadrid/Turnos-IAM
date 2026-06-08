// ============================================================
// report.js — Planificador de Turnos
// Métricas de equidad, horas anuales y auditoría
// ============================================================

// Horas por turno (ambos son 9h)
const HOURS_MORNING   = 9;
const HOURS_AFTERNOON = 9;
const HOURS_ANNUAL_LIMIT = 1782; // límite RRHH

/**
 * Genera el informe de equidad + horas anuales por técnico.
 */
window.generateEquityReport = function(users, schedule, vacations, holidays) {
  const metrics = {};

  users.forEach(u => {
    metrics[u.id] = {
      id:            u.id,
      name:          u.name,
      morningDays:   0,
      afternoonDays: 0,
      vacationDays:  window.getVacationDaysUsed(u.id, vacations),
      holidayDays:   0,
      totalWorked:   0,
      totalHours:    0,
      hoursStatus:   '',   // 'ok' | 'warning' | 'over'
      equityScore:   0
    };
  });

  Object.entries(schedule).forEach(([dateStr, day]) => {
    if (day.closed) {
      users.forEach(u => {
        if (!window.isOnVacation(u.id, dateStr, vacations)) {
          metrics[u.id].holidayDays++;
        }
      });
      return;
    }
    (day.morning   || []).forEach(uid => { if (metrics[uid]) metrics[uid].morningDays++;   });
    (day.afternoon || []).forEach(uid => { if (metrics[uid]) metrics[uid].afternoonDays++; });
  });

  users.forEach(u => {
    const m       = metrics[u.id];
    m.totalWorked = m.morningDays + m.afternoonDays;
    m.totalHours  = (m.morningDays * HOURS_MORNING) + (m.afternoonDays * HOURS_AFTERNOON);

    // Estado de horas respecto al límite anual
    const pct = m.totalHours / HOURS_ANNUAL_LIMIT;
    if (m.totalHours > HOURS_ANNUAL_LIMIT)      m.hoursStatus = 'over';
    else if (pct >= 0.95)                        m.hoursStatus = 'warning';
    else                                         m.hoursStatus = 'ok';

    // Score de equidad: penaliza desviación del balance ideal mañana/tarde (~25% tarde)
    const ratio   = m.totalWorked > 0 ? m.afternoonDays / m.totalWorked : 0;
    const ideal   = 0.25;
    m.equityScore = Math.max(0, 100 - Math.round(Math.abs(ratio - ideal) * 200));
  });

  return Object.values(metrics);
};

/**
 * Genera resumen mensual de cobertura.
 */
window.generateMonthlySummary = function(schedule, users, holidays, year) {
  const summary = {};
  for (let m = 0; m < 12; m++) {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`;
    summary[key] = {
      month: window.monthName(m),
      totalDays: 0, closedDays: 0, understaffedDays: 0,
      avgMorningCoverage: 0, avgAfternoonCoverage: 0
    };
  }
  Object.entries(schedule).forEach(([dateStr, day]) => {
    const d   = window.parseLocalDate(dateStr);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!summary[key]) return;
    summary[key].totalDays++;
    if (day.closed) { summary[key].closedDays++; return; }
    const mc = (day.morning   || []).length;
    const ac = (day.afternoon || []).length;
    summary[key].avgMorningCoverage   += mc;
    summary[key].avgAfternoonCoverage += ac;
    if (mc < 2 || ac < 2) summary[key].understaffedDays++;
  });
  Object.values(summary).forEach(s => {
    const w = s.totalDays - s.closedDays;
    if (w > 0) {
      s.avgMorningCoverage   = (s.avgMorningCoverage   / w).toFixed(1);
      s.avgAfternoonCoverage = (s.avgAfternoonCoverage / w).toFixed(1);
    }
  });
  return Object.values(summary);
};

/**
 * Exporta el informe de equidad + horas como CSV.
 */
window.exportEquityReportCSV = function(users, schedule, vacations, holidays) {
  const rows = window.generateEquityReport(users, schedule, vacations, holidays).map(m => ({
    'Técnico':          m.name,
    'Días Mañana':      m.morningDays,
    'Días Tarde':       m.afternoonDays,
    'Vacaciones (días)':m.vacationDays,
    'Total Trabajado':  m.totalWorked,
    'Horas Totales':    m.totalHours,
    'Límite RRHH':      HOURS_ANNUAL_LIMIT,
    'Diferencia h':     m.totalHours - HOURS_ANNUAL_LIMIT,
    'Score Equidad':    m.equityScore + '%'
  }));
  window.exportToCSV(rows, 'informe_equidad_planturnos');
  window.showToast('Informe exportado correctamente.', 'success');
};

/**
 * Exporta el cuadrante completo como CSV.
 */
window.exportScheduleCSV = function(schedule, users) {
  const userMap = {};
  users.forEach(u => userMap[u.id] = u.name);
  const rows = [];
  Object.keys(schedule).sort().forEach(dateStr => {
    const day = schedule[dateStr];
    if (day.closed) {
      rows.push({ fecha: dateStr, turno: 'CIERRE', tecnico: day.holiday || 'Festivo' });
      return;
    }
    (day.morning   || []).forEach(uid => rows.push({ fecha: dateStr, turno: 'Mañana', tecnico: userMap[uid] || uid }));
    (day.afternoon || []).forEach(uid => rows.push({ fecha: dateStr, turno: 'Tarde',  tecnico: userMap[uid] || uid }));
  });
  window.exportToCSV(rows, 'cuadrante_planturnos');
  window.showToast('Cuadrante exportado correctamente.', 'success');
};
