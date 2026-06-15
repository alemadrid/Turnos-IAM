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
  localStorage.removeItem('planturnos_startdates_2026');
  localStorage.removeItem('planturnos_joinDates_2026');
  localStorage.removeItem('planturnos_shifts_cfg');
  localStorage.removeItem('planturnos_hourslimits');
  window.showToast('Datos locales eliminados. Recarga la página.', 'warning');
};

// ─── GitHub API sync (datos visibles desde cualquier navegador) ──────────────
// El admin introduce un Personal Access Token (PAT) con permisos Contents:Write
// en el repo. Los datos se sincronizan como archivos JSON en data/. Cualquier
// navegador los ve al cargar la página (GitHub Pages los sirve como estáticos).

window.getGHToken = function() {
  return localStorage.getItem('planturnos_gh_token') || '';
};
window.setGHToken = function(t) {
  if (t) localStorage.setItem('planturnos_gh_token', t);
  else   localStorage.removeItem('planturnos_gh_token');
};
window.getGHRepo = function() {
  return localStorage.getItem('planturnos_gh_repo') || 'alemadrid/Turnos-IAM';
};
window.setGHRepo = function(r) {
  localStorage.setItem('planturnos_gh_repo', r || 'alemadrid/Turnos-IAM');
};

/**
 * Obtiene el SHA actual de un archivo en GitHub (sin caché).
 * @returns {string|null}
 */
async function ghGetSHA(url, headers) {
  try {
    const res = await fetch(url, {
      headers: { ...headers, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (res.ok) return (await res.json()).sha || null;
    if (res.status === 404) return null; // archivo nuevo
  } catch (_) {}
  return null;
}

/**
 * Escribe (o actualiza) un archivo en el repo GitHub vía Contents API.
 * Reintenta una vez con SHA fresco si hay conflicto (SHA stale).
 * @returns {{ ok: boolean, reason?: string }}
 */
window.ghWriteFile = async function(filePath, data) {
  const token = window.getGHToken();
  const repo  = window.getGHRepo();
  if (!token) return { ok: false, reason: 'no_token' };

  const url     = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = {
    'Authorization':        `Bearer ${token}`,
    'Accept':               'application/vnd.github.v3+json',
    'Content-Type':         'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };

  // Codificar en base64 con soporte Unicode completo
  const jsonStr = JSON.stringify(data, null, 2);
  const content = btoa(unescape(encodeURIComponent(jsonStr)));

  const doWrite = async (sha) => {
    const body = { message: `sync(data): ${filePath}`, content, branch: 'main' };
    if (sha) body.sha = sha;
    return fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  };

  try {
    // Primer intento: obtenemos SHA sin caché
    const sha1   = await ghGetSHA(url, headers);
    const putRes = await doWrite(sha1);

    if (putRes.ok) return { ok: true };

    // Si el error es conflicto de SHA (409), reintentamos con SHA fresco
    if (putRes.status === 409 || putRes.status === 422) {
      const sha2    = await ghGetSHA(url, headers);
      const putRes2 = await doWrite(sha2);
      if (putRes2.ok) return { ok: true };
      const err2 = await putRes2.json().catch(() => ({}));
      return { ok: false, reason: `conflicto SHA (${putRes2.status})` };
    }

    const err = await putRes.json().catch(() => ({}));
    return { ok: false, reason: err.message || String(putRes.status) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
};

/**
 * Sincroniza todos los datos operativos a GitHub en paralelo.
 * @param {boolean} silent - si true, solo muestra errores (no toast de éxito)
 */
window.syncAllToGitHub = async function(silent = false) {
  const token = window.getGHToken();
  if (!token) {
    if (!silent) window.showToast(
      '⚠ Sin token de GitHub. Configúralo en Configuración → Sincronización GitHub.',
      'warning', 6000
    );
    return false;
  }

  const files = [
    { path: 'data/vacations.json',      data: window.loadVacationsLocal()    },
    { path: 'data/schedule.json',       data: window.loadScheduleLocal()     },
    { path: 'data/userStartDates.json', data: window.loadUserStartDates()    },
    { path: 'data/userHoursLimits.json',data: window.loadUserHoursLimits()   },
    { path: 'data/shifts.json',         data: window.loadShiftsLocal() || {} }
  ];

  if (!silent) window.showToast('⏳ Sincronizando con GitHub…', 'info', 2500);
  const results = await Promise.all(files.map(f => window.ghWriteFile(f.path, f.data)));
  const failed  = results.filter(r => !r.ok && r.reason !== 'no_token');

  if (failed.length === 0) {
    if (!silent) window.showToast(
      '✅ Sincronizado. Visible en todos los navegadores en ~1 min.',
      'success', 5000
    );
    return true;
  }
  window.showToast(
    `⚠ Sync parcial (${failed.map(f => f.reason).join(', ')}). Comprueba el token.`,
    'warning', 7000
  );
  return false;
};

// ─── Horarios de turno (configurables) ───────────────────────
window.loadShiftsLocal = function() {
  try {
    const raw = localStorage.getItem('planturnos_shifts_cfg');
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
};
window.saveShiftsLocal = function(data) {
  try { localStorage.setItem('planturnos_shifts_cfg', JSON.stringify(data)); }
  catch (e) { console.error('saveShiftsLocal:', e); }
};

// ─── Límites de horas anuales por técnico ────────────────────
window.loadUserHoursLimits = function() {
  try {
    const raw = localStorage.getItem('planturnos_hourslimits');
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
};
window.saveUserHoursLimits = function(data) {
  try { localStorage.setItem('planturnos_hourslimits', JSON.stringify(data)); }
  catch (e) { console.error('saveUserHoursLimits:', e); }
};

/**
 * Guarda las fechas de inicio de técnicos (overrides sobre users.json).
 * Permite registrar cuándo empezó cada técnico en la empresa / en el período
 * para el cómputo de horas hasta el 6 de julio.
 */
window.saveUserStartDates = function(overrides) {
  try {
    localStorage.setItem('planturnos_startdates_2026', JSON.stringify(overrides));
  } catch (e) {
    window.showToast('Error al guardar fechas de inicio.', 'error');
    console.error('saveUserStartDates:', e);
  }
};

/**
 * Carga las fechas de inicio de técnicos desde localStorage.
 */
window.loadUserStartDates = function() {
  try {
    const raw = localStorage.getItem('planturnos_startdates_2026');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error('loadUserStartDates:', e);
    return {};
  }
};
