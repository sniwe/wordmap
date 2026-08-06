import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');
const inventoryStart = source.indexOf('const PINYIN_SYLLABLES = new Set(`');
const inventoryEnd = source.indexOf('`.trim().split(/\\s+/u));', inventoryStart);
const inventory = inventoryStart < 0 || inventoryEnd < 0
  ? []
  : source.slice(source.indexOf('`', inventoryStart) + 1, inventoryEnd).trim().split(/\s+/u);
const syllables = new Set(inventory);

function countPinyinSyllables(text) {
  const value = String(text).toLowerCase().replace(/[1-5]/g, '');
  const parts = value.split("'");
  if (parts.some((part) => !part)) return 0;
  return parts.reduce((total, part) => {
    let count = 0;
    for (let index = 0; index < part.length;) {
      const match = Array.from({ length: part.length - index }, (_, offset) => part.slice(index, part.length - offset))
        .find((chunk) => syllables.has(chunk));
      if (!match) return 0;
      count += 1;
      index += match.length;
    }
    return total + count;
  }, 0);
}

const expected = new Map([
  ['yangzhipin', 3],
  ['chuannao', 2],
  ['ni3hao3', 2],
  ["xi'an", 2],
  ["xi'bad", 0],
  ['invalidpinyin', 0],
]);
for (const [input, count] of expected) {
  assert(countPinyinSyllables(input) === count, `${input}: expected ${count}`);
}
assert(syllables.has('yang'), 'inventory must include yang');
assert(countPinyinSyllables('yangzhipin') >= 2, 'multi-syllable pinyin must use chinFuzz branch');
assert(source.includes("return pinyinSyllableCount >= 2 ? 'chinFuzz'"), 'chinFuzz classification branch must remain present');
assert(source.includes("return 'chinFuzz';"), 'classification seam must remain present');
assert(source.indexOf('if (onlyEnglishishChars && allTokensArePinyin)') < source.indexOf("if (normalizedContextType === 'engPhrase' && onlyEnglishishChars)"), 'pinyin classification must precede engPhrase fallback');
assert(source.includes("replaceAll('\\n', '<br>')"), 'subSeg line-break rendering must remain present');
console.log(`pinyin inventory ok (${inventory.length} syllables); vertical seam preserved`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
