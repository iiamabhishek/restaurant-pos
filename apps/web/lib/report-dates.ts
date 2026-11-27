export function localDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function monthToDate(today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  return { from: localDate(first), to: localDate(today) };
}
