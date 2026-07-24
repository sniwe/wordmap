import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainJs = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');
const serverJs = await readFile(new URL('../../../src/public/server.js', import.meta.url), 'utf8');

const enterBlock = mainJs.slice(mainJs.indexOf("if (event.key === 'Enter')"), mainJs.indexOf('if (isSpaceKey(event)', mainJs.indexOf("if (event.key === 'Enter')")));
assert(enterBlock.includes('selectionTouchesLangUnitBubble(editor)'), 'Enter keeps existing-bubble selection priority');
assert(
  enterBlock.indexOf('wrapSelectedSubSegText(editor)') < enterBlock.indexOf('getSubSegBubbleTargetIndex(editor) >= 0'),
  'plain selection wraps before active target opens child subSeg'
);
assert(
  /targetLangUnitId[\s\S]*bubble\.dataset\.langunitCycleGroupId = targetLangUnitId/.test(mainJs),
  'wrapped non-contiguous bubble stores active cycle group id'
);
assert(
  /function getLangUnitBubbleGroupId\(bubble\)[\s\S]*langunitCycleGroupId[\s\S]*getLangUnitCycleTargetId\(langUnitId\)/.test(mainJs) &&
    /\.filter\(\(bubble\) => getLangUnitBubbleGroupId\(bubble\) === targetLangUnitId\)/.test(mainJs),
  'live cycle-select honors a newly captured bubble group before refresh'
);
assert(
  /const cycleGroupId = String\(node\.getAttribute\('data-langunit-cycle-group-id'\)[\s\S]*\.\.\.\(cycleGroupId \? \{ cycleGroupId \} : \{\}\)/.test(mainJs),
  'editor payload persists bubble cycle group id into langUnit instances'
);
assert(
  /return `<span class="langunit-bubble"[\s\S]*\$\{cycleGroupAttr\}/.test(mainJs) &&
    /return segment\.connector \? `<span class="langunit-connector">/.test(mainJs),
  'render path keeps cycle group attributes and dotted connectors'
);
assert(
  /tokens\.some\(\(token\) => token\?\.type === 'langUnitRef' && getLangUnitCycleTargetId\(token\.langUnitId\) === langUnitId\)/.test(mainJs),
  'ref list finds remote occurrences through shared cycle target'
);
assert(
  /event\.key === 'Delete'[\s\S]*unwrapLangUnitBubbleTarget\(editor\)/.test(mainJs) &&
    /function unwrapLangUnitBubbleTarget\(editor\)[\s\S]*getLangUnitBubbleGroupId\(bubble\) === targetLangUnitId/.test(mainJs),
  'Ctrl+Delete still unwraps the targeted linked bubble group'
);
assert(
  /event\.key === 'Backspace'[\s\S]*focusParentSubSegInput\(editor\)/.test(mainJs),
  'Ctrl+Backspace still returns child subSeg focus to the parent'
);
assert(
  /isSpaceKey\(event\)[\s\S]*handleLangUnitBubbleSpace\(editor\)/.test(mainJs) &&
    /pending && now - pending\.at < 250/.test(mainJs),
  'double-space bubble escape still routes through the existing handler'
);
assert(
  /replaceAll\('\\n', '<br>'\)/.test(mainJs),
  'subSeg render path keeps newline-to-br rendering'
);
assert(
  /const nextCycleGroupId = String\(idMap\.get\(cycleGroupId\) \?\? cycleGroupId\)/.test(serverJs),
  'server remaps langUnit instance cycleGroupId during canonicalization'
);

const langUnits = [
  { _id: 'anchor', text: 'alpha', instances: [{ subSegId: 's1', start: 0, end: 5 }] },
  { _id: 'remote', text: 'omega', instances: [{ subSegId: 's1', remote: true, cycleGroupId: 'anchor', start: 10, end: 15 }] },
];

const cycleTarget = (id, seen = new Set()) => {
  if (!id || seen.has(id)) return id;
  seen.add(id);
  const item = langUnits.find((langUnit) => langUnit._id === id);
  const next = String(item?.instances?.find((instance) => instance?.cycleGroupId)?.cycleGroupId ?? '').trim();
  return next && next !== id ? cycleTarget(next, seen) || id : id;
};

const content = [
  { type: 'langUnitRef', langUnitId: 'anchor' },
  { type: 'text', text: ' gap\nline ' },
  { type: 'langUnitRef', langUnitId: 'remote', remote: true },
];
assert.deepEqual(
  [...new Set(content.filter((token) => token.type === 'langUnitRef').map((token) => cycleTarget(token.langUnitId)))],
  ['anchor'],
  'anchor and remote occurrence resolve to one cycle-select target'
);
assert.equal(
  content.some((token) => token.type === 'langUnitRef' && cycleTarget(token.langUnitId) === 'anchor'),
  true,
  'ref row matcher includes remote-only occurrence by cycle target'
);
assert.equal(content[2].remote, true, 'remote marker survives pointer-only content token');
assert.equal(content[1].text.replaceAll('\n', '<br>'), ' gap<br>line ', 'line break rendering survives grouped content gap');

const idMap = new Map([['anchor', 'canonical-anchor']]);
const remapped = langUnits.map((item) => ({
  ...item,
  instances: item.instances.map((instance) => ({
    ...instance,
    ...(instance.cycleGroupId ? { cycleGroupId: idMap.get(instance.cycleGroupId) ?? instance.cycleGroupId } : {}),
  })),
}));
assert.equal(remapped[1].instances[0].cycleGroupId, 'canonical-anchor', 'canonical remap rewrites remote cycleGroupId');

console.log('non-contiguous langUnit capture verifier passed');
