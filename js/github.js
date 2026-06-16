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
// Rama destino. Vacío = rama por defecto del repo (se detecta automáticamente).
window.getGHBranch = function() {
  return localStorage.getItem('planturnos_gh_branch') || '';
};
window.setGHBranch = function(b) {
  if (b) localStorage.setItem('planturnos_gh_branch', b);
  else   localStorage.removeItem('planturnos_gh_branch');
};

// Caché en memoria de la rama por defecto detectada (por repo).
let _ghDefaultBranchCache = {};

/**
 * Resuelve la rama destino: la configurada manualmente o la rama por defecto
 * del repositorio (consultada vía API y cacheada). Si no se puede detectar,
 * devuelve null para que la Contents API use la rama por defecto implícita.
 */
async function ghResolveBranch(repo, headers) {
  const manual = window.getGHBranch();
  if (manual) return manual;
  if (_ghDefaultBranchCache[repo]) return _ghDefaultBranchCache[repo];
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { ...headers, 'Cache-Control': 'no-cache' }
    });
    if (res.ok) {
      const def = (await res.json()).default_branch || null;
      if (def) _ghDefaultBranchCache[repo] = def;
      return def;
    }
  } catch (_) {}
  return null;
}

// SHA autoritativo de cada archivo según la última escritura correcta de esta
// sesión. Evita depender del GET (cacheable) entre escrituras consecutivas.
let _ghShaCache = {};

/**
 * Obtiene el SHA actual de un archivo en GitHub (sin caché).
 * @returns {{ found: boolean, sha: string|null, error?: boolean }}
 */
async function ghGetSHA(url, headers, branch) {
  // Cache-busting: la Contents API se sirve desde caché de CDN y tras una
  // escritura el SHA puede venir obsoleto durante ~1 min → el PUT siguiente
  // fallaría con 422. Un parámetro único fuerza una respuesta fresca.
  let u = `${url}?_=${Date.now()}`;
  if (branch) u += `&ref=${encodeURIComponent(branch)}`;
  try {
    const res = await fetch(u, {
      headers: { ...headers, 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    if (res.ok)            return { found: true,  sha: (await res.json()).sha || null };
    if (res.status === 404) return { found: false, sha: null }; // archivo nuevo
    return { found: false, sha: null, error: true };            // 401/403/5xx…
  } catch (_) {
    return { found: false, sha: null, error: true };
  }
}

/**
 * Escribe (o actualiza) un archivo en el repo GitHub vía Contents API.
 * Reintenta varias veces con SHA fresco ante conflictos de SHA/ref (409/422).
 * @returns {{ ok: boolean, reason?: string, status?: number }}
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

  // Rama destino: configurada o por defecto del repo (null = implícita)
  const branch   = await ghResolveBranch(repo, headers);
  const cacheKey = `${repo}@${branch || ''}:${filePath}`;

  // Codificar en base64 con soporte Unicode completo
  const jsonStr = JSON.stringify(data, null, 2);
  const content = btoa(unescape(encodeURIComponent(jsonStr)));

  const doWrite = async (sha) => {
    const body = { message: `sync(data): ${filePath}`, content };
    if (branch) body.branch = branch;
    if (sha)    body.sha    = sha;
    return fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  };

  // Hasta 4 intentos. En el 1º usamos el SHA autoritativo en caché (devuelto
  // por la última escritura correcta), evitando el GET cacheable. Si falla con
  // 409/422 (SHA obsoleto) refrescamos vía GET con cache-busting y reintentamos.
  // Errores de token/permiso (401/403/404) no se reintentan.
  let lastReason = 'desconocido';
  let lastStatus = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      let sha;
      if (attempt === 0 && Object.prototype.hasOwnProperty.call(_ghShaCache, cacheKey)) {
        sha = _ghShaCache[cacheKey]; // SHA autoritativo de la última escritura
      } else {
        const shaInfo = await ghGetSHA(url, headers, branch);
        if (shaInfo.error) {
          return { ok: false, reason: 'no se pudo leer el archivo (token o permisos)', status: 403 };
        }
        sha = shaInfo.sha;
      }

      const putRes = await doWrite(sha);
      if (putRes.ok) {
        // Guardamos el SHA nuevo devuelto por GitHub para la próxima escritura
        const okBody = await putRes.json().catch(() => ({}));
        if (okBody && okBody.content && okBody.content.sha) {
          _ghShaCache[cacheKey] = okBody.content.sha;
        }
        return { ok: true };
      }

      lastStatus = putRes.status;
      const err  = await putRes.json().catch(() => ({}));
      lastReason = err.message || String(putRes.status);

      if (putRes.status === 409 || putRes.status === 422) {
        delete _ghShaCache[cacheKey]; // SHA cacheado inválido → refrescar vía GET
        await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
        continue; // SHA caducado: refrescamos y reintentamos
      }
      if (putRes.status === 401 || putRes.status === 403) {
        return { ok: false, reason: 'token inválido o sin permiso Contents:Write', status: putRes.status };
      }
      if (putRes.status === 404) {
        return { ok: false, reason: 'repositorio o rama no encontrados', status: 404 };
      }
      return { ok: false, reason: lastReason, status: putRes.status };
    } catch (e) {
      lastReason = e.message;
    }
  }
  return { ok: false, reason: lastReason, status: lastStatus };
};

/**
 * Sincroniza todos los datos operativos a GitHub.
 * Las llamadas se serializan (cola) para que dos sync nunca se solapen y
 * provoquen carreras de SHA al escribir el mismo archivo a la vez.
 * @param {boolean} silent - si true, solo muestra errores (no toast de éxito)
 */
let _ghSyncQueue = Promise.resolve();
window.syncAllToGitHub = function(silent = false) {
  const run = () => _syncAllToGitHubImpl(silent);
  // Encadenamos sobre la cola; capturamos errores para no romper la cadena.
  _ghSyncQueue = _ghSyncQueue.then(run, run);
  return _ghSyncQueue;
};

async function _syncAllToGitHubImpl(silent) {
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

  // Secuencial (NO en paralelo): cada archivo es un commit a la misma rama.
  // Varios commits simultáneos chocan en el ref/SHA de la rama y GitHub los
  // rechaza con 409/422. Escribiendo uno tras otro cada commit se asienta
  // antes del siguiente y se evitan los "conflicto SHA".
  const failed = [];
  for (const f of files) {
    const r = await window.ghWriteFile(f.path, f.data);
    if (!r.ok && r.reason !== 'no_token') failed.push({ file: f.path, ...r });
  }

  if (failed.length === 0) {
    if (!silent) window.showToast(
      '✅ Sincronizado. Visible en todos los navegadores en ~1 min.',
      'success', 5000
    );
    return true;
  }

  // Diagnóstico claro del token: si hay 401/403 el PAT no sirve o le falta
  // el permiso Contents:Write; lo más probable es que haya caducado.
  const authIssue = failed.some(f => f.status === 401 || f.status === 403);
  const msg = authIssue
    ? '⚠ El token de GitHub no es válido o le falta el permiso «Contents: Write» (puede haber caducado). Genera uno nuevo en GitHub y vuelve a guardarlo.'
    : `⚠ Sync parcial (${[...new Set(failed.map(f => f.reason))].join('; ')}). Pulsa «Sincronizar ahora» para reintentar.`;
  window.showToast(msg, 'warning', 8000);
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
