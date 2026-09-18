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
  return { names: names as string[], profileCode: codeRaw && codeRaw !== 'none' ? codeRaw : null };
}
