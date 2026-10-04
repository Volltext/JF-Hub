export const newId = (): string => crypto.randomUUID();
export const nowIso = (): string => new Date().toISOString();
export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
