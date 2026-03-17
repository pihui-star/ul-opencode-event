/**
 * Simple template rendering function for variable replacement.
 * Replaces {{variableName}} patterns with corresponding values.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string | undefined>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return variables[key] ?? "";
  });
}
