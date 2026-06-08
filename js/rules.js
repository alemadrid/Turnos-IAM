// ============================================================
// rules.js — Planificador de Turnos
// Validador de restricciones legales y alertas de cobertura
// ============================================================

/**
 * Valida un periodo vacacional.
 * Devuelve:
 *   { valid: false, warn: false, message }  → error duro, no se puede guardar
 *   { valid: true,  warn: true,  message }  → aviso suave, pedir confirmación
 *   { valid: true,  warn: false, message }  → todo correcto
 */
window.validateVacationRequest = function(startStr, endStr, userId, existingVacations) {
  if (!startStr || !endStr) {
    return { valid: false, warn: false, message: 'Debes indicar fecha de inicio y fin.' };
  }

  const start = window.parseLocalDate(startStr);
  const end   = window.parseLocalDate(endStr);

  if (end < start) {
    return { valid: false, warn: false, message: 'La fecha de fin debe ser igual o posterior a la de inicio.' };
  }

  // ─── Regla 2026: AVISO (no bloqueo) si inicio >= 15 julio ───
  // Se recomienda semana íntegra lun–dom (≥7 días, múltiplo de 7).
  // Si no cumple → valid:true, warn:true → la UI pide confirmación.
  const cutoff = new Date(2026, 6, 15, 0, 0, 0, 0);
  if (start >= cutoff) {
    const diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const issues   = [];

    if (start.getDay() !== 1) {
      issues.push(`no empieza en lunes (empieza en ${window.dayNameFull(start.getDay())})`);
    }
    if (end.getDay() !== 0) {
      issues.push(`no termina en domingo (termina en ${window.dayNameFull(end.getDay())})`);
    }
    if (diffDays < 7 || diffDays % 7 !== 0) {
      issues.push(`duración de ${diffDays} día${diffDays===1?'':'s'} (se recomiendan múltiplos de 7)`);
    }

    if (issues.length > 0) {
      return {
        valid:   true,
        warn:    true,
        message: `⚠️ Recomendación 2026\n\nPara vacaciones a partir del 15 de julio se recomiendan semanas íntegras (lun–dom, mínimo 7 días).\n\nEste periodo no cumple: ${issues.join('; ')}.\n\n¿Deseas guardarlo igualmente?`
      };
    }
  }

  // ─── Solapamiento con vacaciones existentes ──────────────────
  if (existingVacations && existingVacations[userId]) {
    for (const v of existingVacations[userId]) {
      const vs = window.parseLocalDate(v.start);
      const ve = window.parseLocalDate(v.end);
      if (window.rangesOverlap(start, end, vs, ve)) {
        return {
          valid: false,
          warn:  false,
          message: `❌ El periodo solicitado se solapa con unas vacaciones ya registradas (${v.start} → ${v.end}).`
        };
      }
    }
  }

  return { valid: true, warn: false, message: 'Periodo vacacional válido.' };
};

/**
 * Verifica si un técnico está de vacaciones en una fecha concreta.
 */
window.isOnVacation = function(userId, dateStr, vacations) {
  if (!vacations || !vacations[userId]) return false;
  const d = window.parseLocalDate(dateStr);
  for (const v of vacations[userId]) {
    const vs = window.parseLocalDate(v.start);
    const ve = window.parseLocalDate(v.end);
    if (d >= vs && d <= ve) return true;
  }
  return false;
};

/**
 * Verifica si una fecha es festivo de cierre total.
 */
window.isGlobalHoliday = function(dateStr, holidays) {
  if (!holidays || !holidays.closure) return false;
  return holidays.closure.some(h => h.date === dateStr);
};

/**
 * Nombre de un festivo para cualquier categoría.
 */
window.getHolidayName = function(dateStr, holidays) {
  if (!holidays) return null;
  const all = [
    ...(holidays.closure  || []),
    ...(holidays.national || []),
    ...(holidays.alicante || [])
  ];
  const found = all.find(h => h.date === dateStr);
  return found ? found.name : null;
};

/**
 * Cobertura de un día.
 */
window.getDayCoverage = function(dateStr, schedule) {
  if (!schedule[dateStr]) return { morning: 0, afternoon: 0, warnings: ['Sin datos.'] };
  const day  = schedule[dateStr];
  const warnings = [];
  const mc = (day.morning   || []).length;
  const ac = (day.afternoon || []).length;
  if (mc < 2) warnings.push(`Cobertura mañana insuficiente: ${mc}/2.`);
  if (ac < 2) warnings.push(`Cobertura tarde insuficiente: ${ac}/2.`);
  return { morning: mc, afternoon: ac, warnings };
};

/**
 * Días de vacaciones usados por un técnico.
 */
window.getVacationDaysUsed = function(userId, vacations) {
  if (!vacations || !vacations[userId]) return 0;
  let total = 0;
  for (const v of vacations[userId]) {
    const s    = window.parseLocalDate(v.start);
    const e    = window.parseLocalDate(v.end);
    const diff = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
    total += diff;
  }
  return total;
};

/**
 * Validación global del equipo.
 */
window.validateFullTeam = function(users, vacations) {
  const issues = [];
  users.forEach(u => {
    const used = window.getVacationDaysUsed(u.id, vacations);
    if (used > u.vacationDaysTotal) {
      issues.push({ userId: u.id, name: u.name,
        message: `${u.name}: ${used} días asignados, máximo ${u.vacationDaysTotal}.` });
    }
  });
  return issues;
};
