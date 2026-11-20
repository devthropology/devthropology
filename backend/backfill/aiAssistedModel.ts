const COAUTHORED_BY_REGEX = /^co-authored-by:\s*(.+)$/gim;

export function extractFirstAiAssistedModel(
  commitMessages: string[],
): string | null {
  for (const commitMessage of commitMessages) {
    const model = extractAiAssistedModelFromCommitMessage(commitMessage);
    if (model) {
      return model;
    }
  }

  return null;
}

function extractAiAssistedModelFromCommitMessage(
  commitMessage: string,
): string | null {
  for (const match of commitMessage.matchAll(COAUTHORED_BY_REGEX)) {
    const rawName = normalizeCoauthorName(match[1]);
    if (isSupportedAiModel(rawName)) {
      return rawName;
    }
  }

  return null;
}

function normalizeCoauthorName(value: string): string {
  return value
    .trim()
    .replace(/<[^>]*>/g, "")
    .trim();
}

function isSupportedAiModel(value: string): boolean {
  return value.toLowerCase().startsWith("claude");
}
