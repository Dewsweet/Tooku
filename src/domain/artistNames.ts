export function normalizeArtistName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function artistSearchNames(name: string): string[] {
  const original = name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if (!original) return [];
  const names = [original];
  const pair = /^([^()]+)\(([^()]+)\)$/u.exec(original);
  if (pair) {
    const outside = pair[1].trim(); const inside = pair[2].trim();
    // Parentheses may describe a role or recording rather than an alternative name.
    const descriptive = /(?:\b(?:feat|featuring|ft|cv|live|remaster(?:ed)?|cover|version|instrumental)\b|作曲|演唱|原唱|配音|声优|聲優|伴奏|现场|現場|版本|翻唱)/iu;
    if (outside && inside && /\p{L}/u.test(inside) && !descriptive.test(inside)) names.push(outside, inside);
  }
  const seen = new Set<string>();
  return names.filter((item) => { const normalized = normalizeArtistName(item); if (seen.has(normalized)) return false; seen.add(normalized); return true; });
}
