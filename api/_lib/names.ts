/* What's in a leaderboard name: slurs, profanity and names that pass for staff are turned away, server side only, so
   this list never ships to the game. The words are kept ROT13'd so the file doesn't read as a wall of slurs; rot13()
   below turns them back (and it's how to add one: rot13('word')).
   A name is checked as it might be read: accents stripped, leetspeak undone (0 o, 1 i or l, 3 e, 4 a, 5 s, 7 t ...),
   and squashed (spaces and . _ - ' gone, so "f u c k" is caught), with any letter allowed to repeat ("fuuuck"; a
   doubled letter has to stay doubled, so "Niger" isn't the n-word). ANYWHERE words are caught inside other words;
   WHOLE words only on their own (word by word, or the whole name squashed), since as substrings they're in innocent
   names: class, Dickens, Kshitij, Gandum, therapist. */

export const rot13 = (s: string) => s.replace(/[a-z]/g, c => String.fromCharCode((c.charCodeAt(0) - 84) % 26 + 97));

const words = (s: string) => s.trim().split(/\s+/).map(rot13);
const ANYWHERE = words(`
  avttre avttn avtt avtyrg snttbg sntbg sntt ergneq genaal genaavr xvxr xlxr
  tbbx jrgonpx ornare enturnq gbjryurnq wvtnobb cbepuzbaxrl whatyrohaal tbyyvjbt mvccreurnq furznyr phag
  shpx sphx cuhpx zbgures ovgpu ovngpu juber fyhg pbpxfhpx qvpxurnq qvpxsnpr nffubyr
  nefrubyr onfgneq jnaxre gjng obyybpx chffl cravf intvan qvyqb cbea wvmm phzfubg
  phzfyhg oybjwbo unaqwbo evzwbo betnfz znfgheong zbyrfg crqbcuvy cnrqbcuvy uvgyre xxx zvys
  uragnv ohyyfuvg fuvgurnq fuvgsnpr qvcfuvg ubefrfuvg xvyylbhefrys znqnepubq znqrepubq orurapubq ourapubq orapubq
  puhgvln puhgvlr puhgvn oubfq yniqn ynjqn wungh wunngh puvany xhgvln craqrwb pnoeba
  znevpba zvreqn puvatn phyreb
`);
const WHOLE = words(`
  snt sntf puvax fcvp fcvpx pbba pbbaf cnxv qlxr qvpx qvpxf pbpx
  pbpxf gvg gvgf gvggl gvggvrf obbo obbof phz nany nahf nff nefr
  jnax cevpx cvff encr encrq encvfg crqb anmv anmvf urvy frk frkl
  ubeal ahqr ahqrf shx spx sh fuvg fuvgf fuvggl fuvgr chgn chgb
  iretn pbab yhaq ynhqn ofqx kkk xlf arteb avt ubzb yrfob tnaqh
`);
const RESERVED = words(`
  nqzva nqzvavfgengbe zbqrengbe zbq fgnss bssvpvny flfgrz ebbg bjare qrirybcre
`);

/** a word as a pattern: each run of a letter may run longer (a doubled letter stays at least doubled) */
const pattern = (w: string) => w.replace(/(.)\1*/g, run => `${run[0]}{${run.length},}`);
const anywhere = new RegExp(ANYWHERE.map(pattern).join('|'));
const whole = new RegExp(`^(?:${[...WHOLE, ...RESERVED].map(pattern).join('|')})$`);

const LEET: Record<string, string> = { 0: 'o', 3: 'e', 4: 'a', 5: 's', 6: 'g', 7: 't', 8: 'b', 9: 'g' };
const FOLD: Record<string, string> = { ß: 'ss', æ: 'ae', ø: 'o', þ: 'th', ð: 'd' };

/** the ways a name might be read: lower case, no accents, leetspeak undone (1 as an i and as an l) */
function readings(name: string): string[] {
  const plain = name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[ßæøþð]/g, c => FOLD[c]).replace(/[0345-9]/g, d => LEET[d]);
  return [plain.replace(/1/g, 'i'), plain.replace(/1/g, 'l')];
}

/** true if the name is fine to show */
export function decentName(name: string): boolean {
  for (const r of readings(name)) {
    const squashed = r.replace(/[^a-z]/g, '');
    if (anywhere.test(squashed) || whole.test(squashed)) return false;
    for (const word of r.split(/[^a-z]+/)) if (word && whole.test(word)) return false;
  }
  return true;
}

/** two names are the same leaderboard entry if they read the same: case, accents and spacing aside */
export function nameKey(name: string): string {
  return name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}
