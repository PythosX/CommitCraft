/** Formatting + escaping helpers shared by every page. */

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes, { decimals = 1 } = {}) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 100 ? 0 : decimals)} ${units[unit]}`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(
    Number(value) || 0
  );
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function timeAgo(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const thresholds = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, secondsInUnit] of thresholds) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return formatter.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return formatter.format(seconds, 'second');
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function shortSha(sha, length = 7) {
  return sha ? String(sha).slice(0, length) : '';
}

export function statusLabel(status) {
  return (
    {
      queued: 'Queued',
      running: 'Publishing',
      paused: 'Paused',
      completed: 'Completed',
      partial: 'Partially completed',
      failed: 'Failed',
      cancelled: 'Cancelled',
      waiting: 'Waiting',
      processing: 'Processing',
      committing: 'Committing',
      skipped: 'Skipped',
    }[status] || status
  );
}

export function statusTone(status) {
  if (['completed'].includes(status)) return 'success';
  if (['failed'].includes(status)) return 'error';
  if (['partial', 'paused', 'queued'].includes(status)) return 'warning';
  if (['cancelled', 'skipped'].includes(status)) return 'muted';
  if (['running', 'processing', 'committing'].includes(status)) return 'accent';
  return 'muted';
}
