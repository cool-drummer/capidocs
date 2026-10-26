const BROWSERS: [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\/|Opera/, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: [RegExp, string][] = [
  [/iPhone|iPad|iPod/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

export function describeDevice(userAgent: string | null | undefined): string {
  const agent = userAgent ?? '';
  const browser = BROWSERS.find(([pattern]) => pattern.test(agent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(agent))?.[1];
  if (browser && system) return `${browser} en ${system}`;
  return browser ?? system ?? 'un navegador desconocido';
}
