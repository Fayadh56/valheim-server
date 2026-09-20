export interface ModsView {
  names: string[];
  profileCode: string | null;
}

export function modsView(packagesRaw: string, codeRaw: string): ModsView | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packagesRaw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const names = parsed.map((p) => (p && typeof p === 'object' && typeof (p as { name?: unknown }).name === 'string' ? (p as { name: string }).name.replace(/_/g, ' ') : undefined));
  if (names.some((n) => n === undefined)) return undefined;
  // Server-only mods are not something friends install, so the page leaves them out
  const shared = (parsed as Array<{ name: string; serverOnly?: boolean }>).filter((p) => !p.serverOnly).map((p) => p.name.replace(/_/g, ' '));
  if (shared.length === 0) return undefined;
  return { names: shared, profileCode: codeRaw && codeRaw !== 'none' ? codeRaw : null };
}
