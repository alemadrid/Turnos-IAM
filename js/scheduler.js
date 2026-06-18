// ============================================================
// scheduler.js — Planificador de Turnos
// Motor de asignación en cascada de 3 niveles
// Reglas de festivos:
//   closure  → servicio cerrado (nadie)
//   national → 2 mañana + 2 tarde
//   alicante → 4 mañana + 2 tarde
//   normal   → todos mañana excepto pareja tarde
// Solo lunes-viernes. Sáb/Dom: sin cuadrante.
// ============================================================

/**
 * Detecta el tipo de festivo de una fecha.
 * @returns 'closure' | 'national' | 'alicante' | null
 */
window.getHolidayType = function(dateStr, holidays) {
  if (!holidays) return null;
  if ((holidays.closure  || []).some(h => h.date === dateStr)) return 'closure';
  if ((holidays.national || []).some(h => h.date === dateStr)) return 'national';
  if ((holidays.alicante || []).some(h => h.date === dateStr)) return 'alicante';
  return null;
};

/**
 * Devuelve el nombre del festivo para cualquier categoría.
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
 * Indica si el día es festivo de cierre total.
 */
window.isGlobalHoliday = function(dateStr, holidays) {
  return window.getHolidayType(dateStr, holidays) === 'closure';
};

/**
 * Mezcla un array (Fisher-Yates) para variedad en la selección.
 */
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Genera el cuadrante completo para un rango de semanas.
 * Solo genera días laborables (lun-vie).
 */
window.generateSchedule = function(weeks, users, vacations, holidays, config) {
  const schedule      = {};
  const contingencies = [];

  // Contadores de equidad por técnico
  const penalties              = {};
  const lastAfternoonWeekIndex = {};
  const monthAfternoonCount    = {};
  const holidayWorkCount       = {}; // festivos (national/alicante) trabajados

  users.forEach(u => {
    penalties[u.id]              = 0;
    lastAfternoonWeekIndex[u.id] = -99;
    monthAfternoonCount[u.id]    = {};
    holidayWorkCount[u.id]       = 0;
  });

  // ── Reparto equitativo de festivos ──────────────────────────
  // Selecciona a quienes MENOS festivos han trabajado hasta ahora.
  // Desempate: menor penalización de tardes y, finalmente, aleatorio.
  const pickHolidayWorkers = (pool, count) =>
    shuffled(pool)
      .sort((a, b) =>
        (holidayWorkCount[a.id] - holidayWorkCount[b.id]) ||
        (penalties[a.id] - penalties[b.id]))
      .slice(0, count);

  // Reparte a los trabajadores del festivo en tarde (preferente 1 senior + 1 junior)
  // y el resto a mañana.
  const splitHolidayShift = (workers, aftCount) => {
    const sen = workers.filter(u => u.profile === 'senior');
    const jun = workers.filter(u => u.profile === 'junior');
    let aft;
    if (aftCount === 2 && sen.length >= 1 && jun.length >= 1) {
      aft = [sen[0], jun[0]];
    } else {
      aft = workers.slice(0, aftCount);
    }
    const aftIds = aft.map(u => u.id);
    const mor = workers.filter(u => !aftIds.includes(u.id));
    return { aft, mor };
  };

  weeks.forEach((monday, weekIdx) => {
    // Solo días lun-vie (índices 0-4 del array getWeekDays)
    const weekDays    = window.getWeekDays(monday).slice(0, 5);
    const mondayStr   = window.formatDateLocal(monday);
    const monthKey    = `${monday.getFullYear()}-${monday.getMonth()}`;

    // Disponibles esta semana: no de vacaciones el lunes Y ya incorporados
    const availableUsers = users.filter(u =>
      !window.isOnVacation(u.id, mondayStr, vacations) &&
      window.getEffectiveStartDate(u.id) <= mondayStr
    );

    const seniors  = availableUsers.filter(u => u.profile === 'senior');
    const juniors  = availableUsers.filter(u => u.profile === 'junior');

    // ── Seleccionar pareja de tarde para la semana (Nivel 1-3) ──
    let afternoonPair = null;
    let usedLevel     = 1;

    const findBestPair = (senList, junList, allowConsec, allowOverMonth) => {
      let best = Infinity, bs = null, bj = null;
      for (const s of senList) {
        if (!allowConsec && (weekIdx - lastAfternoonWeekIndex[s.id]) <= 1) continue;
        if (!allowOverMonth && (monthAfternoonCount[s.id][monthKey] || 0) >= config.algorithmWeights.afternoonCountMonthlyLimit) continue;
        for (const j of junList) {
          if (!allowConsec && (weekIdx - lastAfternoonWeekIndex[j.id]) <= 1) continue;
          if (!allowOverMonth && (monthAfternoonCount[j.id][monthKey] || 0) >= config.algorithmWeights.afternoonCountMonthlyLimit) continue;
          const score = penalties[s.id] + penalties[j.id] - config.algorithmWeights.seniorStandardBonus;
          if (score < best) { best = score; bs = s; bj = j; }
        }
      }
      return (bs && bj) ? [bs, bj] : null;
    };

    // Nivel 1: óptimo
    afternoonPair = findBestPair(seniors, juniors, false, false);

    // Nivel 2a: relajar consecutividad
    if (!afternoonPair && seniors.length && juniors.length) {
      afternoonPair = findBestPair(seniors, juniors, true, false);
      if (afternoonPair) {
        usedLevel = 2;
        contingencies.push(`⚠ Semana ${mondayStr}: restricción de consecutividad relajada (${afternoonPair.map(u=>u.name).join(' + ')}).`);
      }
    }

    // Nivel 2b: relajar límite mensual
    if (!afternoonPair && seniors.length && juniors.length) {
      afternoonPair = findBestPair(seniors, juniors, true, true);
      if (afternoonPair) {
        usedLevel = 2;
        contingencies.push(`⚠ Semana ${mondayStr}: límite mensual de tardes superado (${afternoonPair.map(u=>u.name).join(' + ')}).`);
      }
    }

    // Nivel 3: emergencia — cualquier pareja disponible
    if (!afternoonPair && availableUsers.length >= 2) {
      usedLevel = 3;
      const sorted = [...availableUsers].sort((a, b) => penalties[a.id] - penalties[b.id]);
      afternoonPair = [sorted[0], sorted[1]];
      contingencies.push(`🚨 Semana ${mondayStr}: Nivel 3 emergencia — pareja no estándar (${afternoonPair.map(u=>u.name).join(' + ')}). Revisión recomendada.`);
    }

    if (!afternoonPair) {
      contingencies.push(`❌ Semana ${mondayStr}: sin personal suficiente para turno de tarde.`);
      afternoonPair = [];
    }

    const afternoonIds = afternoonPair.map(u => u.id);

    // Actualizar contadores de equidad
    afternoonPair.forEach(u => {
      penalties[u.id]              += config.algorithmWeights.consecutiveAfternoonPenalty * usedLevel;
      lastAfternoonWeekIndex[u.id]  = weekIdx;
      if (!monthAfternoonCount[u.id][monthKey]) monthAfternoonCount[u.id][monthKey] = 0;
      monthAfternoonCount[u.id][monthKey]++;
    });

    // ── Asignar cada día laborable ──────────────────────────────
    // IMPORTANTE: para la asignación diaria se consultan TODOS los usuarios
    // filtrados por vacaciones de ese día concreto — no solo los disponibles
    // el lunes. Esto resuelve el caso de vacaciones parciales de semana
    // (ej: vacaciones vie 31 jul → lun 4 ago: el técnico está de vacaciones
    // el lunes pero trabaja mié–vie de esa semana).
    weekDays.forEach(day => {
      const dateStr = window.formatDateLocal(day);
      const holType = window.getHolidayType(dateStr, holidays);
      const holName = window.getHolidayName(dateStr, holidays);

      // Cierre total
      if (holType === 'closure') {
        schedule[dateStr] = { morning: [], afternoon: [], closed: true, holidayType: 'closure', holiday: holName };
        return;
      }

      // Disponibles ese día: no de vacaciones Y ya incorporados en esa fecha
      const dayAvailable = users.filter(u =>
        !window.isOnVacation(u.id, dateStr, vacations) &&
        window.getEffectiveStartDate(u.id) <= dateStr
      );

      if (holType === 'national') {
        // Festivo nacional: 2 mañana + 2 tarde, repartido EQUITATIVAMENTE
        // entre quienes menos festivos han trabajado.
        const need    = Math.min(4, dayAvailable.length);
        const workers = pickHolidayWorkers(dayAvailable, need);
        const { aft, mor } = splitHolidayShift(workers, Math.min(2, workers.length));
        workers.forEach(u => holidayWorkCount[u.id]++);
        schedule[dateStr] = {
          morning: mor.slice(0, 2).map(u => u.id),
          afternoon: aft.map(u => u.id),
          closed: false, holidayType: 'national', holiday: holName
        };
        return;
      }

      if (holType === 'alicante') {
        // Festivo Alicante/CV: 4 mañana + 2 tarde, repartido EQUITATIVAMENTE.
        const need    = Math.min(6, dayAvailable.length);
        const workers = pickHolidayWorkers(dayAvailable, need);
        const { aft, mor } = splitHolidayShift(workers, Math.min(2, workers.length));
        workers.forEach(u => holidayWorkCount[u.id]++);
        schedule[dateStr] = {
          morning: mor.slice(0, 4).map(u => u.id),
          afternoon: aft.map(u => u.id),
          closed: false, holidayType: 'alicante', holiday: holName
        };
        return;
      }

      // Día normal:
      // - Tarde: miembros de la pareja semanal que ese día NO están de vacaciones
      // - Mañana: resto de técnicos disponibles ese día (incluye miembros de la pareja
      //   que ese día SÍ están de vacaciones → no, esos no están en dayAvailable;
      //   pero también incluye técnicos que el lunes estaban de vacaciones pero
      //   este día concreto ya no lo están)
      const afternoonUsers = afternoonPair.filter(u =>
        !window.isOnVacation(u.id, dateStr, vacations) &&
        window.getEffectiveStartDate(u.id) <= dateStr
      );
      const afternoonDayIds = afternoonUsers.map(u => u.id);
      const morningUsers    = dayAvailable.filter(u => !afternoonDayIds.includes(u.id));

      schedule[dateStr] = {
        morning:     morningUsers.map(u => u.id),
        afternoon:   afternoonDayIds,
        closed:      false,
        holidayType: null,
        holiday:     null
      };
    });
  });

  // ── Verificación automática de restricciones ────────────────
  const violations = window.verifySchedule(schedule, users, vacations, holidays);
  violations.forEach(v => contingencies.push(v));

  return { schedule, contingencies };
};

/**
 * Comprueba que el cuadrante cumple todas las restricciones planteadas:
 *  - Cobertura mínima (2 mañana / 2 tarde en días normales).
 *  - Nadie en mañana y tarde el mismo día.
 *  - Pareja de tarde estructurada (1 senior + 1 junior) en días normales.
 *  - Equidad de festivos trabajados entre todo el equipo.
 * Devuelve un array de mensajes (vacío si todo correcto).
 */
window.verifySchedule = function(schedule, users, vacations, holidays) {
  const issues = [];
  const holidayWork   = {};
  const afternoonWork = {};
  const morningWork   = {};
  users.forEach(u => { holidayWork[u.id] = 0; afternoonWork[u.id] = 0; morningWork[u.id] = 0; });
  const profileOf = id => { const u = users.find(x => x.id === id); return u ? u.profile : null; };

  Object.entries(schedule).forEach(([dateStr, day]) => {
    if (day.closed) return;
    const m = day.morning   || [];
    const a = day.afternoon || [];

    // Nadie duplicado mañana + tarde
    const both = m.filter(id => a.includes(id));
    if (both.length) issues.push(`❌ ${dateStr}: técnico asignado a mañana y tarde a la vez.`);

    m.forEach(id => morningWork[id]++);
    a.forEach(id => afternoonWork[id]++);

    const isHoliday = day.holidayType === 'national' || day.holidayType === 'alicante';
    if (isHoliday) {
      m.concat(a).forEach(id => holidayWork[id]++);
      if (a.length < 2) issues.push(`⚠ ${dateStr} (festivo): cobertura de tarde ${a.length}/2.`);
    } else {
      if (m.length < 2) issues.push(`⚠ ${dateStr}: cobertura de mañana ${m.length}/2.`);
      if (a.length < 2) issues.push(`⚠ ${dateStr}: cobertura de tarde ${a.length}/2.`);
      // Pareja de tarde: preferente 1 senior + 1 junior
      if (a.length === 2) {
        const profs = a.map(profileOf);
        if (!(profs.includes('senior') && profs.includes('junior'))) {
          issues.push(`ℹ ${dateStr}: pareja de tarde no estándar (${profs.join(' + ')}).`);
        }
      }
    }
  });

  // Equidad de festivos trabajados
  const hw = users.map(u => holidayWork[u.id]);
  if (hw.length) {
    const hwMax = Math.max(...hw), hwMin = Math.min(...hw);
    if (hwMax - hwMin > 2) {
      const detalle = users.map(u => `${u.name}: ${holidayWork[u.id]}`).join(', ');
      issues.push(`⚠ Equidad de festivos: rango ${hwMin}–${hwMax} (${detalle}).`);
    }
  }

  return issues;
};
