// ============================================================
// utils.js — Aequitas WFM
// Helpers de fecha inmunes a zona horaria, hashing y exportador
// ============================================================

/**
 * Parsea un string "YYYY-MM-DD" en un objeto Date local sin desfase UTC.
 * Solución al Antídoto #3: Timezone Offset Crash.
 */
window.parseLocalDate = function(str) {
  if (!str) return null;
  const parts = str.split('-');
  if (parts.length !== 3) return null;
  const year  = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day   = parseInt(parts[2], 10);
  return new Date(year, month, day, 0, 0, 0, 0);
};

/**
 * Formatea un Date a "YYYY-MM-DD" en zona horaria local.
 */
window.formatDateLocal = function(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Devuelve el lunes de la semana a la que pertenece la fecha dada.
 */
window.getMondayOfWeek = function(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const day = d.getDay(); // 0=Dom, 1=Lun…
  const diff = (day === 0) ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
};

/**
 * Devuelve un array de fechas (Date) de lunes a domingo de una semana.
 */
window.getWeekDays = function(monday) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 0, 0, 0, 0);
    days.push(d);
  }
  return days;
};

/**
 * Devuelve todas las semanas (lunes) dentro de un rango [startDate, endDate].
 */
window.getWeeksInRange = function(startStr, endStr) {
  const start = window.parseLocalDate(startStr);
  const end   = window.parseLocalDate(endStr);
  const weeks = [];
  let monday  = window.getMondayOfWeek(start);
  while (monday <= end) {
    weeks.push(new Date(monday));
    monday.setDate(monday.getDate() + 7);
  }
  return weeks;
};

/**
 * Verifica si dos rangos de fechas se solapan.
 */
window.rangesOverlap = function(s1, e1, s2, e2) {
  return s1 <= e2 && s2 <= e1;
};

/**
 * Computa el hash SHA-256 de un string usando la API nativa crypto.subtle.
 * Devuelve una Promise con el hex string.
 */
window.sha256 = async function(message) {
  const msgBuffer  = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

/**
 * Exporta datos a un archivo CSV descargable.
 * @param {Array<Object>} rows - Array de objetos planos
 * @param {string} filename - nombre del archivo sin extensión
 */
window.exportToCSV = function(rows, filename) {
  if (!rows || rows.length === 0) {
    alert('No hay datos para exportar.');
    return;
  }
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(';'),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
        return val.includes(';') ? `"${val}"` : val;
      }).join(';')
    )
  ].join('\n');

  const BOM  = '\uFEFF'; // BOM para Excel en español
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Exporta datos a JSON descargable (backup completo).
 */
window.exportToJSON = function(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href     = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Nombre corto del mes en español.
 */
window.monthName = function(monthIndex) {
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return months[monthIndex] || '';
};

window.dayName = function(dayIndex) {
  const days = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  return days[dayIndex] || '';
};

window.dayNameFull = function(dayIndex) {
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  return days[dayIndex] || '';
};

/**
 * Muestra un toast de notificación en pantalla.
 */
window.showToast = function(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    'ℹ'
  };
  const colors = {
    success: 'toast-success',
    error:   'toast-error',
    warning: 'toast-warning',
    info:    'toast-info'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${colors[type] || 'toast-info'}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span class="toast-msg">${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 400);
  }, duration);
};
