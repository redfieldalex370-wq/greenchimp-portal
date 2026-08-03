export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';
}

export function relativeTime(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function clockTime(value: string) {
  return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export function windowCountdown(value: string | null) {
  if (!value) return 'Ventana cerrada';
  const minutes = Math.floor((Date.parse(value) - Date.now()) / 60_000);
  if (minutes <= 0) return 'Ventana cerrada';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `Ventana ${hours} h ${rest} min`;
}
