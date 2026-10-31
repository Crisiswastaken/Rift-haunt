/* What a leaderboard name may look like: 2 to 16 characters of Latin letters (accents too), digits, spaces and
   . _ - ', with at least two letters or digits. Tidied first: Unicode-normalised, trimmed, runs of spaces made one.
   The game checks this as you type; the server checks it again, and what's in the name (names.ts) after that. */
export const NAME = { min: 2, max: 16 };

const ALLOWED = /^[A-Za-z0-9À-ÖØ-öø-ÿ _.'-]+$/;

/** the tidied name, or why it won't do */
export function shapeName(raw: unknown): { name: string } | { error: string } {
  const name = String(raw ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const length = [...name].length;
  if (length < NAME.min) return { error: `Names need at least ${NAME.min} characters.` };
  if (length > NAME.max) return { error: `Names can be ${NAME.max} characters at most.` };
  if (!ALLOWED.test(name)) return { error: 'Letters, numbers, spaces and . _ - \' only.' };
  if ((name.match(/[A-Za-z0-9À-ÖØ-öø-ÿ]/g) ?? []).length < 2) return { error: 'Names need a couple of letters or numbers.' };
  return { name };
}
