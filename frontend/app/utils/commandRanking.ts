export function rankCommandMatch(value: string, search: string, keywords: string[] = []): number {
  const query = search.trim().toLowerCase();
  if (!query) {
    return 1;
  }

  const normalizedValue = value.toLowerCase();
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());

  if (normalizedValue === query || normalizedKeywords.some((keyword) => keyword === query)) {
    return 1;
  }

  if (normalizedValue.startsWith(query)) {
    return 0.95;
  }

  if (normalizedKeywords.some((keyword) => keyword.startsWith(query))) {
    return 0.9;
  }

  if (normalizedValue.split(/[^a-z0-9]+/).some((part) => part.startsWith(query))) {
    return 0.8;
  }

  if (normalizedValue.includes(query)) {
    return 0.65;
  }

  if (normalizedKeywords.some((keyword) => keyword.includes(query))) {
    return 0.55;
  }

  return 0;
}
