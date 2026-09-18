const CRON = /^cron\((\d{1,2}) (\d{1,2}) \* \* \? \*\)$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateTime(hhmm: string): boolean {
  return HHMM.test(hhmm);
}

export function timeToCron(hhmm: string): string {
  if (!validateTime(hhmm)) throw new Error(`invalid time: ${hhmm}`);
  const [hour, minute] = hhmm.split(':').map(Number);
  return `cron(${minute} ${hour} * * ? *)`;
}

export function cronToTime(expr: string): string {
  const match = CRON.exec(expr);
  if (!match) throw new Error(`unsupported cron expression: ${expr}`);
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
