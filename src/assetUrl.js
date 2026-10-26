const base = import.meta.env.BASE_URL;

export function assetUrl(path) {
  return `${base}${String(path).replace(/^\/+/, '')}`;
}
