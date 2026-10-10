/** `http://192.168.68.51:4318/…` → `192.168.68.`: what a phone on the same home network's address starts with. */
export function networkPrefix(link: string): string {
  const host = new URL(link).hostname;
  return /^\d+\.\d+\.\d+\.\d+$/.test(host) ? `${host.split('.').slice(0, 3).join('.')}.` : host;
}
