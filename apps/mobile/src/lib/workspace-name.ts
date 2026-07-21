export function workspaceName(workspacePath: string | undefined) {
  if (!workspacePath) {
    return undefined;
  }

  return workspacePath
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1);
}
