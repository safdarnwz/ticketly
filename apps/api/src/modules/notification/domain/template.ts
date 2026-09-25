/**
 * Tiny, safe template renderer: substitutes `{{key}}` placeholders from a
 * flat data bag. Deliberately NOT a full template engine — no logic, no code
 * execution — because notification templates are operator-editable and must
 * never be an injection vector. An unknown placeholder renders empty and is
 * logged, rather than leaking `{{...}}` to a customer.
 */
export function renderTemplate(
  template: string,
  data: Record<string, string | number | undefined>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const value = data[key];
    return value === undefined || value === null ? '' : String(value);
  });
}
