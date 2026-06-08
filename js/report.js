// ============================================================
// report.js — Aequitas WFM
// Compilador métrico de equidad anual y generador de auditorías
// ============================================================

/**
 * Genera el informe de equidad anual para todos los técnicos.
 * @returns {Array<Object>} rows para CSV/tabla
 */
window.generateEquityReport = function(users, schedule, vacations, holidays) {
  const metrics = {};

  users.forEach(u => {
    metrics[u.id] = {
      id:             u.id,
      name:           u.name,
      profile:        u.profile,
      morningDays:    0,
      afternoonDays:  0,
      vacationDays:   window.getVacationDaysUsed(u.id, vacations),
      holidayDays:    0,
      totalWorked:    0,
      equityScore:    0
    };
  });

  Object.entries(schedule).forEach(([dateStr, day]) => {
    if (day.closed) {
      // Festivo global — no computa trabajo
      users.forEach(u => {
        if (!window.isOnVacation(u.id, dateStr, vacations)) {
          metrics[u.id].holidayDays++;
        }
      });
      return;
    }

    (day.morning || []).forEach(uid => {
      if (metrics[uid]) metrics[uid].morningDays++;
    });
    (day.afternoon || []).forEach(uid => {
      if (metrics[uid]) metrics[uid].afternoonDays++;
    });
  });

  users.forEach(u => {
    const m = metrics[u.id];
    m.totalWorked = m.morningDays + m.afternoonDays;
    // Score de equidad: penaliza desviación del balance ideal mañana/tarde
    const ratio   = m.totalWorked > 0 ? m.afternoonDays / m.totalWorked : 0;
    const ideal   = 0.25; // ~25% de días en tarde es el objetivo
    m.equityScore = Math.max(0, 100 - Math.round(Math.abs(ratio - ideal) * 200));
  });

  return Object.values(metrics);
};

/**
 * Genera el log de auditoría de cambios manuales en el cuadrante.
 */
window.generateAuditLog = function(auditTrail) {
  return (auditTrail || []).map(entry => ({
    timestamp:   entry.timestamp,
    action:      entry.action,
    date:        entry.date,
    shift:       entry.shift,
    userId:      entry.userId,
    userName:    entry.userName,
    performedBy: entry.performedBy || 'Sistema'
  }));
};

/**
 * Genera resumen mensual de cobertura.
 */
window.generateMonthlySummary = function(schedule, users, holidays, year) {
  const summary = {};

  for (let m = 0; m < 12; m++) {
    const key = `${year}-${String(m + 1).padStart(2, '0')}`;
    summary[key] = {
      month:              window.monthName(m),
      totalDays:          0,
      closedDays:         0,
      understaffedDays:   0,
      avgMorningCoverage: 0,
      avgAfternoonCoverage: 0
    };
  }

  Object.entries(schedule).forEach(([dateStr, day]) => {
    const d   = window.parseLocalDate(dateStr);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!summary[key]) return;

    summary[key].totalDays++;

    if (day.closed) {
      summary[key].closedDays++;
      return;
    }

    const mc = (day.morning   || []).length;
    const ac = (day.afternoon || []).length;
    summary[key].avgMorningCoverage   += mc;
    summary[key].avgAfternoonCoverage += ac;
    if (mc < 2 || ac < 2) summary[key].understaffedDays++;
  });

  Object.values(summary).forEach(s => {
    const workDays = s.totalDays - s.closedDays;
    if (workDays > 0) {
      s.avgMorningCoverage   = (s.avgMorningCoverage   / workDays).toFixed(1);
      s.avgAfternoonCoverage = (s.avgAfternoonCoverage / workDays).toFixed(1);
    }
  });

  return Object.values(summary);
};

/**
 * Exporta el informe de equidad como CSV.
 */
window.exportEquityReportCSV = function(users, schedule, vacations, holidays) {
  const rows = window.generateEquityReport(users, schedule, vacations, holidays);
  window.exportToCSV(rows, 'informe_equidad_planturnos');
  window.showToast('Informe de equidad exportado correctamente.', 'success');
};

/**
 * Exporta el cuadrante completo como CSV (una fila por día/técnico).
 */
window.exportScheduleCSV = function(schedule, users) {
  const userMap = {};
  users.forEach(u => userMap[u.id] = u.name);

  const rows = [];
  const sortedDates = Object.keys(schedule).sort();

  sortedDates.forEach(dateStr => {
    const day = schedule[dateStr];
    if (day.closed) {
      rows.push({ fecha: dateStr, turno: 'CIERRE', tecnico: day.holiday || 'Festivo', perfil: '-' });
      return;
    }
    (day.morning || []).forEach(uid => {
      const u = users.find(x => x.id === uid);
      rows.push({ fecha: dateStr, turno: 'Mañana', tecnico: userMap[uid] || uid, perfil: u ? u.profile : '-' });
    });
    (day.afternoon || []).forEach(uid => {
      const u = users.find(x => x.id === uid);
      rows.push({ fecha: dateStr, turno: 'Tarde', tecnico: userMap[uid] || uid, perfil: u ? u.profile : '-' });
    });
  });

  window.exportToCSV(rows, 'cuadrante_planturnos');
  window.showToast('Cuadrante exportado correctamente.', 'success');
};
