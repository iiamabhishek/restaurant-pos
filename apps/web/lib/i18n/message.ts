export type MessageValues = Record<string, string | number>;

export function formatMessage(template: string, values?: MessageValues): string {
  if (!values) return template;
  // Substitute once. A person's name can contain braces or replacement syntax such as "$&".
  return template.replace(/\{(\w+)\}/g, (token, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : token,
  );
}
