// ============================================================
// github.js — Aequitas WFM
// Manejador de estado local e importación/exportación de backups
// Antídoto #2: NUNCA guardar config ni hashes en localStorage
// ============================================================

const STORAGE_KEYS = {
  SCHEDULE:    'planturnos_schedule_2026',
  VACATIONS:   'planturnos_vacations_2026',
  AUDIT_TRAIL: 'planturnos_audit_2026'
};

/**
 * Guarda el cuadrante en localStorage (solo datos operativos).
 */
window.saveScheduleLocal = function(schedule) {
  try {
    localStorage.setItem(STORAGE_KEYS.SCHEDULE, JSON.stringify(schedule));
  } catch (e) {
    window.showToast('Error al guardar el cuadrante localmente.', 'error');
    console.error('saveScheduleLocal:', e);
  }
};

/**
 * Carga el cuadrante desde localStorage.
 */
window.loadScheduleLocal = function() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SCHEDULE);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('loadScheduleLocal:', e);
    return {};
  }
};

/**
 * Guarda las vacaciones en localStorage.
 */
window.saveVacationsLocal = function(vacations) {
  try {
    localStorage.setItem(STORAGE_KEYS.VACATIONS, JSON.stringify(vacations));
  } catch (e) {
    window.showToast('Error al guardar vacaciones localmente.', 'error');
    console.error('saveVacationsLocal:', e);
  }
};

/**
 * Carga las vacaciones desde localStorage.
 */
window.loadVacationsLocal = function() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VACATIONS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('loadVacationsLocal:', e);
    return {};
  }
};

/**
 * Añade una entrada al log de auditoría.
 */
window.appendAuditEntry = function(action, date, shift, userId, userName, performedBy) {
  try {
    const raw   = localStorage.getItem(STORAGE_KEYS.AUDIT_TRAIL);
    const trail = raw ? JSON.parse(raw) : [];
    trail.push({
      timestamp:   new Date().toISOString(),
      action, date, shift, userId, userName, performedBy
    });
    // Limitar a últimas 500 entradas para no saturar localStorage
    if (trail.length > 500) trail.splice(0, trail.length - 500);
    localStorage.setItem(STORAGE_KEYS.AUDIT_TRAIL, JSON.stringify(trail));
  } catch (e) {
    console.error('appendAuditEntry:', e);
  }
};

/**
 * Carga el trail de auditoría.
 */
window.loadAuditTrail = function() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AUDIT_TRAIL);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

/**
 * Exporta un backup completo de los datos operativos a JSON.
 * NO incluye config ni hashes (Antídoto #2).
 */
window.exportBackup = function() {
  const backup = {
    version:    '2.0.0',
    exportedAt: new Date().toISOString(),
    schedule:   window.loadScheduleLocal(),
    vacations:  window.loadVacationsLocal(),
    auditTrail: window.loadAuditTrail()
  };
  window.exportToJSON(backup, 'backup_planificador_turnos');
  window.showToast('Backup exportado correctamente.', 'success');
};

/**
 * Importa un backup desde archivo JSON.
 * @param {File} file
 * @param {Function} onSuccess - callback(schedule, vacations)
 */
window.importBackup = function(file, onSuccess) {
  if (!file) {
    window.showToast('Selecciona un archivo de backup válido.', 'warning');
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.schedule || !data.vacations) {
        throw new Error('Formato de backup inválido.');
      }
      window.saveScheduleLocal(data.schedule);
      window.saveVacationsLocal(data.vacations);
      if (data.auditTrail) {
        localStorage.setItem(STORAGE_KEYS.AUDIT_TRAIL, JSON.stringify(data.auditTrail));
      }
      window.showToast('Backup importado y restaurado correctamente.', 'success');
      if (typeof onSuccess === 'function') onSuccess(data.schedule, data.vacations);
    } catch (err) {
      window.showToast(`Error al importar: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
};

/**
 * Limpia todos los datos operativos del localStorage (reset completo).
 */
window.clearAllLocalData = function() {
  localStorage.removeItem(STORAGE_KEYS.SCHEDULE);
  localStorage.removeItem(STORAGE_KEYS.VACATIONS);
  localStorage.removeItem(STORAGE_KEYS.AUDIT_TRAIL);
  window.showToast('Datos locales eliminados. Recarga la página.', 'warning');
};
