export function getProjectFolderDisplayName(folderPath: string | null | undefined): string {
  if (!folderPath) {
    return 'missing'
  }

  const normalizedPath = folderPath.replace(/[\\/]+$/, '')
  const segments = normalizedPath.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? normalizedPath
}

export function hasConnectedProjectFolder(folderPath: string | null | undefined): boolean {
  return Boolean(folderPath?.trim())
}
