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
/**
 * @param {string}  joinDate2026Str  - fecha YYYY-MM-DD de incorporación
 * @param {number}  [annualLimit]    - límite individual (si no se pasa, usa HOURS_ANNUAL_LIMIT)
 */
function calcProportionalHours(joinDate2026Str, annualLimit) {
  const limit = (annualLimit && annualLimit > 0) ? annualLimit : HOURS_ANNUAL_LIMIT;
  const ratio = limit / WORKDAYS_2026;  // h proporcional por día laborable
  const YEAR_START = '2026-01-01';
  const YEAR_END   = '2026-12-31';

  // Si no tiene joinDate2026 o es anterior/igual a 1 ene → año completo
  if (!joinDate2026Str || joinDate2026Str <= YEAR_START) {
    return limit;
  }
  if (joinDate2026Str > YEAR_END) return 0;

  const dias = countWorkdays(joinDate2026Str, YEAR_END);
  return Math.round(dias * ratio);
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

  // Horas efectivas por turno: de APP.shifts si está configurado, o fallback 8h
  const shiftCfg   = (typeof APP !== 'undefined' && APP.shifts) || null;
  const mEffective = (shiftCfg?.morning?.hours   > 0) ? shiftCfg.morning.hours   - 1 : HOURS_EFFECTIVE_PER_SHIFT;
  const aEffective = (shiftCfg?.afternoon?.hours > 0) ? shiftCfg.afternoon.hours - 1 : HOURS_EFFECTIVE_PER_SHIFT;

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
  // Diferencia mañana/tarde para reflejar las horas configuradas en cada turno
  let turnHours = 0;
  Object.entries(schedule).forEach(([dateStr, day]) => {
    if (day.closed) return;
    const d = window.parseLocalDate(dateStr);
    if (d < TURNS_START_D) return; // solo días de turnos
    if (dateStr < effectiveStart) return; // antes del alta del técnico
    const inMorning   = (day.morning   || []).includes(userId);
    const inAfternoon = (day.afternoon || []).includes(userId);
    if (inMorning)   turnHours += mEffective;
    if (inAfternoon) turnHours += aEffective;
  });

  return { preHours, turnHours, total: preHours + turnHours };
}

// Horas netas por turno trabajado (9h – 1h comida)
const HOURS_NET_PER_SHIFT = 8;

// Fecha límite del período de incorporación (inclusive)
const ONBOARDING_END_DATE = '2026-07-06';

/**
 * Genera el informe de equidad + horas anuales por técnico.
 */
window.generateEquityReport = function(users, schedule, vacations, holidays) {
  const metrics = {};

  users.forEach(u => {
    const effectiveStart = (typeof window.getEffectiveStartDate === 'function')
      ? window.getEffectiveStartDate(u.id)
      : (u.joinDate2026 || u.joinDate || '2026-01-01');
    // Límite individual: de APP.userHoursLimits si existe, si no el global
    const userLimit = (typeof APP !== 'undefined' && APP.userHoursLimits && APP.userHoursLimits[u.id])
      ? parseInt(APP.userHoursLimits[u.id])
      : HOURS_ANNUAL_LIMIT;
    metrics[u.id] = {
      id:               u.id,
      name:             u.name,
      joinDate2026:     effectiveStart,
      morningDays:      0,
      afternoonDays:    0,
      vacationDays:     window.getVacationDaysUsed(u.id, vacations),
      totalWorked:      0,
      hoursProportional: calcProportionalHours(effectiveStart, userLimit),
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
    const acc       = calcAccumulatedHours(u.id, m.joinDate2026, schedule);
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

/**
 * Genera el informe de horas del período de incorporación.
 * Para cada técnico calcula:
 *   - fechaInicio: override de localStorage || joinDate (si ≥ 2026-01-01) || 2026-01-01
 *   - fechaFin: 2026-07-06 (fija)
 *   - targetDays: días laborables (lun–vie, sin cierres) en ese rango
 *   - targetHours: targetDays × 8h (turno 9h − 1h comida)
 *   - workedDays: días que el técnico aparece en el cuadrante dentro del rango
 *   - workedHours: workedDays × 8h
 *   - diff: workedHours − targetHours
 */
window.generateOnboardingReport = function(users, schedule, holidays, userStartDates) {
  const endDate = window.parseLocalDate(ONBOARDING_END_DATE);

  return users.map(u => {
    // Fecha de inicio efectiva
    let startStr = (typeof window.getEffectiveStartDate === 'function')
      ? window.getEffectiveStartDate(u.id)
      : ((userStartDates && userStartDates[u.id]) || u.joinDate2026 || u.joinDate || '2026-01-01');
    if (startStr < '2026-01-01') startStr = '2026-01-01';

    const startDate = window.parseLocalDate(startStr);

    // Si el técnico empieza después del límite, nada que computar
    if (startDate > endDate) {
      return { id: u.id, name: u.name, startDate: startStr,
               targetDays: 0, targetHours: 0, workedDays: 0, workedHours: 0, diff: 0 };
    }

    // Días laborables objetivo en el rango (lun–vie, sin cierres totales)
    let targetDays = 0;
    const cur = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    while (cur <= endDate) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        const ds = window.formatDateLocal(cur);
        const hType = window.getHolidayType(ds, holidays);
        if (hType !== 'closure') targetDays++;
      }
      cur.setDate(cur.getDate() + 1);
    }

    // Días realmente asignados en el cuadrante dentro del rango
    let workedDays = 0;
    Object.entries(schedule).forEach(([dateStr, day]) => {
      if (dateStr < startStr || dateStr > ONBOARDING_END_DATE) return;
      if (day.closed) return;
      if ((day.morning || []).includes(u.id) || (day.afternoon || []).includes(u.id)) {
        workedDays++;
      }
    });

    const targetHours = targetDays * HOURS_NET_PER_SHIFT;
    const workedHours = workedDays * HOURS_NET_PER_SHIFT;

    return {
      id: u.id,
      name: u.name,
      startDate: startStr,
      targetDays,
      targetHours,
      workedDays,
      workedHours,
      diff: workedHours - targetHours
    };
  });
};

/**
 * Exporta el informe de incorporación como CSV.
 */
window.exportOnboardingReportCSV = function(users, schedule, holidays, userStartDates) {
  const rows = window.generateOnboardingReport(users, schedule, holidays, userStartDates).map(m => ({
    'Técnico':            m.name,
    'Fecha Incorporación':m.startDate,
    'Días Objetivo':      m.targetDays,
    'Horas Objetivo (8h/día)': m.targetHours,
    'Días Cuadrante':     m.workedDays,
    'Horas Cuadrante':    m.workedHours,
    'Diferencia h':       m.diff
  }));
  window.exportToCSV(rows, 'informe_incorporacion_planturnos');
  window.showToast('Informe de incorporación exportado.', 'success');
};
