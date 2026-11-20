// Storage keys for filesystem expanded folders
export const FILESYSTEM_EXPANDED_PREFIX = "fs-expanded-";
export const TTL_HOURS = 24;

/**
 * Clear all filesystem expanded folder cache from sessionStorage
 */
export function clearFilesystemCache(): void {
  const keysToRemove: string[] = [];

  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(FILESYSTEM_EXPANDED_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => sessionStorage.removeItem(key));
}

/**
 * Get the storage key for a specific repository's expanded folders
 */
export function getFilesystemStorageKey(repositoryId: string): string {
  return `${FILESYSTEM_EXPANDED_PREFIX}${repositoryId}`;
}
