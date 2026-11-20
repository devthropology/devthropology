import Sqids from "sqids";

export const REPOSITORY_PUBLIC_ID_ALPHABET =
  "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const REPOSITORY_PUBLIC_ID_MIN_LENGTH = 4;

const sqids = new Sqids({
  alphabet: REPOSITORY_PUBLIC_ID_ALPHABET,
  minLength: REPOSITORY_PUBLIC_ID_MIN_LENGTH,
});

export function encodeRepositoryId(internalId: number): string {
  if (!Number.isSafeInteger(internalId) || internalId < 0) {
    throw new Error(`Cannot encode invalid repository id: ${internalId}`);
  }

  return sqids.encode([internalId]);
}

export function decodeRepositoryId(publicId: string): number | null {
  if (!publicId) {
    return null;
  }

  const decoded = sqids.decode(publicId);
  if (decoded.length !== 1) {
    return null;
  }

  const [repositoryId] = decoded;
  if (!Number.isSafeInteger(repositoryId) || repositoryId < 0) {
    return null;
  }

  return repositoryId;
}

export function isLegacyNumericRepositoryRef(ref: string): boolean {
  return /^\d+$/.test(ref);
}

export function resolveRepositoryRef(ref: string): number | null {
  if (isLegacyNumericRepositoryRef(ref)) {
    return Number.parseInt(ref, 10);
  }

  return decodeRepositoryId(ref);
}
