// ============================================================
// report.js — Planificador de Turnos
// Métricas de equidad, horas anuales y auditoría
//
// MARCO LEGAL (art. 34 ET, vigente jun 2026):
//  · Jornada máx: 40h/sem trabajo EFECTIVO en cómputo anual
//  · Descanso/comida (1h): NO computa como trabajo efectivo
//    salvo que el convenio colectivo lo establezca
//  · Horas efectivas por turno de 9h presenciales: 8h
//  · Límite empresa (RRHH): 1.782h anuales
//  · Días laborables 2026 (lun-vie): 261
//  · Ratio proporcional: 1782 / 261 = 6.8276 h/día laborable
//
// PERIODOS de cómputo por técnico:
//  A) Jornada previa (joinDate2026 → 5 jul 2026):
//     8h efectivas por día laborable trabajado
//  B) Periodo turnos (6 jul 2026 → fin cuadrante):
//     8h efectivas por día con turno asignado (9h − 1h descanso)
// ============================================================

const HOURS_EFFECTIVE_PER_SHIFT = 8;   // 9h presenciales − 1h descanso
const HOURS_EFFECTIVE_PRE_TURNS = 8;   // jornada previa estándar
const HOURS_ANNUAL_LIMIT        = 1782;
const WORKDAYS_2026             = 261;
const HOURS_PER_WORKDAY_RATIO   = HOURS_ANNUAL_LIMIT / WORKDAYS_2026; // 6.8276
const TURNS_START               = '2026-07-06'; // inicio del sistema de turnos

/**
 * Cuenta días laborables (lun-vie) en un rango [startStr, endStr] inclusive.
 */
function countWorkdays(startStr, endStr) {
  const s = window.parseLocalDate(startStr);
  const e = window.parseLocalDate(endStr);
  if (!s || !e || s > e) return 0;
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

/**
 * Calcula las horas anuales proporcionales que le corresponden al técnico.
 * Basado en su joinDate2026 (fecha de alta en 2026) y el total de
 * días laborables del año (261).
 */
function calcProportionalHours(joinDate2026Str) {
  const YEAR_START = '2026-01-01';
  const YEAR_END   = '2026-12-31';

  // Si no tiene joinDate2026 o es anterior/igual a 1 ene → año completo
  if (!joinDate2026Str || joinDate2026Str <= YEAR_START) {
    return HOURS_ANNUAL_LIMIT;
  }
  if (joinDate2026Str > YEAR_END) return 0;

  const dias = countWorkdays(joinDate2026Str, YEAR_END);
  return Math.round(dias * HOURS_PER_WORKDAY_RATIO);
}

/**
 * Calcula las horas acumuladas reales de un técnico:
 *   Periodo A: jornada previa (joinDate2026 → 5 jul 2026) = 8h/día lab.
 *   Periodo B: turnos del cuadrante (días con turno asignado) = 8h/turno
 */
function calcAccumulatedHours(userId, joinDate2026Str, schedule) {
  const YEAR_START  = '2026-01-01';
  const PRE_END     = '2026-07-05'; // último día antes de turnos
  const TURNS_START_D = window.parseLocalDate(TURNS_START);

  // Fecha efectiva de alta en 2026
  const effectiveStart = (!joinDate2026Str || joinDate2026Str <= YEAR_START)
    ? YEAR_START
    : joinDate2026Str;

  // ── Periodo A: jornada previa ────────────────────────────────
  // Solo si el técnico estaba antes del 6 jul
  let preHours = 0;
  if (effectiveStart <= PRE_END) {
    const diasPre = countWorkdays(effectiveStart, PRE_END);
    preHours = diasPre * HOURS_EFFECTIVE_PRE_TURNS;
  }

  // ── Periodo B: turnos del cuadrante ─────────────────────────
  let turnHours = 0;
  Object.entries(schedule).forEach(([dateStr, day]) => {
    if (day.closed) return;
    const d = window.parseLocalDate(dateStr);
    if (d < TURNS_START_D) return; // solo días de turnos
    if (dateStr < effectiveStart) return; // antes del alta del técnico
    const isInShift = (day.morning || []).includes(userId) ||
                      (day.afternoon || []).includes(userId);
    if (isInShift) turnHours += HOURS_EFFECTIVE_PER_SHIFT;
  });

  return { preHours, turnHours, total: preHours + turnHours };
}

/**
 * Genera el informe de equidad + horas anuales por técnico.
 */
window.generateEquityReport = function(users, schedule, vacations, holidays) {
  const metrics = {};

  users.forEach(u => {
    metrics[u.id] = {
      id:               u.id,
      name:             u.name,
      joinDate2026:     u.joinDate2026 || '2026-01-01',
      morningDays:      0,
      afternoonDays:    0,
      vacationDays:     window.getVacationDaysUsed(u.id, vacations),
      totalWorked:      0,
      hoursProportional: calcProportionalHours(u.joinDate2026),
      hoursPreTurns:    0,
      hoursTurns:       0,
      hoursTotal:       0,
      hoursDiff:        0,
      hoursStatus:      'ok',
      equityScore:      0
    };
  });

  // Contar días de turno del cuadrante
  Object.entries(schedule).forEach(([dateStr, day]) => {
    if (day.closed) return;
    (day.morning   || []).forEach(uid => { if (metrics[uid]) metrics[uid].morningDays++;   });
    (day.afternoon || []).forEach(uid => { if (metrics[uid]) metrics[uid].afternoonDays++; });
  });

  users.forEach(u => {
    const m = metrics[u.id];
    m.totalWorked = m.morningDays + m.afternoonDays;

    // Horas acumuladas reales
    const acc       = calcAccumulatedHours(u.id, u.joinDate2026, schedule);
    m.hoursPreTurns = acc.preHours;
    m.hoursTurns    = acc.turnHours;
    m.hoursTotal    = acc.total;
    m.hoursDiff     = m.hoursTotal - m.hoursProportional;

    // Estado de horas
    const pct = m.hoursProportional > 0 ? m.hoursTotal / m.hoursProportional : 0;
    m.hoursStatus = m.hoursTotal > m.hoursProportional ? 'over'
                  : pct >= 0.95                        ? 'warning'
                  : 'ok';

    // Score de equidad: penaliza desviación del balance ideal ~25% tarde
    const ratio   = m.totalWorked > 0 ? m.afternoonDays / m.totalWorked : 0;
    m.equityScore = Math.max(0, 100 - Math.round(Math.abs(ratio - 0.25) * 200));
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
 * Exporta informe completo con horas como CSV.
 */
window.exportEquityReportCSV = function(users, schedule, vacations, holidays) {
  const rows = window.generateEquityReport(users, schedule, vacations, holidays).map(m => ({
    'Técnico':                   m.name,
    'Alta 2026':                 m.joinDate2026,
    'Horas proporcionales':      m.hoursProportional,
    'Horas jornada previa':      m.hoursPreTurns,
    'Horas turnos':              m.hoursTurns,
    'Total horas acumuladas':    m.hoursTotal,
    'Diferencia vs proporcional': m.hoursDiff,
    'Días mañana':               m.morningDays,
    'Días tarde':                m.afternoonDays,
    'Vacaciones (días)':         m.vacationDays,
    'Score equidad':             m.equityScore + '%'
  }));
  window.exportToCSV(rows, 'informe_horas_equidad_planturnos');
  window.showToast('Informe exportado correctamente.', 'success');
};

/**
 * Exporta cuadrante completo como CSV.
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
