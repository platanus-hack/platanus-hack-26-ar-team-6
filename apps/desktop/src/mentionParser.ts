export type ResolvedMention = { userId: string; displayName: string };

type RosterUser = { id: string; display_name: string };

function mentionTokensIn(text: string): string[] {
  const matches = text.match(/@(\w+)/g);
  return matches ? matches.map((m) => m.slice(1).toLowerCase()) : [];
}

function matchesToken(user: RosterUser, token: string): boolean {
  const firstName = user.display_name.split(" ")[0].toLowerCase();
  return firstName.startsWith(token);
}

export function parseMentions(text: string, roster: RosterUser[]): ResolvedMention[] {
  const tokens = mentionTokensIn(text);
  if (tokens.length === 0) return [];

  const seen = new Set<string>();
  const results: ResolvedMention[] = [];

  for (const token of tokens) {
    const match = roster.find((u) => matchesToken(u, token));
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      results.push({ userId: match.id, displayName: match.display_name });
    }
  }

  return results;
}

export function stripMentions(text: string, roster: RosterUser[]): string {
  return text
    .replace(/@(\w+)/g, (fullMatch, token) => {
      const matched = roster.some((u) => matchesToken(u, token.toLowerCase()));
      return matched ? "" : fullMatch;
    })
    .replace(/\s{2,}/g, " ")
    .trim();
}
