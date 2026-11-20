const REPO_ID_KEY = "selectedRepositoryId";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function getStoredRepositoryId(): string | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const fromLocalStorage = window.localStorage.getItem(REPO_ID_KEY);
    if (fromLocalStorage) {
      return fromLocalStorage;
    }
  } catch (error) {
    console.warn("Unable to read repository id from localStorage", error);
  }

  const cookieValue = document.cookie
    .split(";")
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.startsWith(`${REPO_ID_KEY}=`));

  if (cookieValue) {
    const value = cookieValue.substring(REPO_ID_KEY.length + 1);
    return decodeURIComponent(value);
  }

  return null;
}

export function persistRepositoryId(repositoryId: string): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(REPO_ID_KEY, repositoryId);
  } catch (error) {
    console.warn("Unable to write repository id to localStorage", error);
  }

  document.cookie = `${REPO_ID_KEY}=${encodeURIComponent(
    repositoryId,
  )}; Path=/; Max-Age=${ONE_YEAR_SECONDS}`;
}

export function clearStoredRepositoryId(): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.removeItem(REPO_ID_KEY);
  } catch (error) {
    console.warn("Unable to clear repository id from localStorage", error);
  }

  document.cookie = `${REPO_ID_KEY}=; Path=/; Max-Age=0`;
}

export { REPO_ID_KEY };
