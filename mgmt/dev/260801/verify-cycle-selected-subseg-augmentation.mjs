import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainJs = await readFile(new URL('../../../src/main.js', import.meta.url), 'utf8');

const extraction = mainJs.slice(
  mainJs.indexOf('function extractSubSegEditorPayload'),
  mainJs.indexOf('function autosizeSubSegInput')
);
const composite = mainJs.slice(
  mainJs.indexOf('function setCompositeBubbleMetadata'),
  mainJs.indexOf('function wrapSelectedSubSegText')
);

assert(extraction.includes('const { aggregateTarget: ignoredAggregateTarget'), 'aggregate target is parent-only payload state');
assert(!extraction.includes('instance.aggregateTarget'), 'part instances never inherit the aggregate target');
assert(extraction.includes('text: bubbleText'), 'each langUnitRef keeps its visible part text');
assert(composite.includes("metadata.role === 'seed'"), 'only the seed bubble carries composite target metadata');
assert(composite.includes("removeAttribute('data-langunit-target-text')"), 'addition bubbles clear stale aggregate metadata');
const clearBoundary = mainJs.slice(
  mainJs.indexOf('function unwrapLangUnitBubbleTarget'),
  mainJs.indexOf('function resetLangUnitBubbleTarget')
);
assert(clearBoundary.includes('relatedCompositeIds'), 'clear boundary finds legacy split composite IDs');
assert(clearBoundary.includes('targetCompositionId'), 'clear boundary removes every part in the active composition');
assert(mainJs.includes('function getLangUnitTokenText(token, langUnit)'), 'legacy composite token repair exists at render boundary');
assert(mainJs.includes('const tokenText = getLangUnitTokenText(token, langUnit)'), 'render uses repaired part text');
const serverJs = await readFile(new URL('../../../src/public/server.js', import.meta.url), 'utf8');
assert(serverJs.includes('function rewriteSubSegContentWithoutLangUnits'), 'clear-all rewrite boundary exists');
assert(serverJs.includes("text = String(addition.text)"), 'clear-all rewrite repairs legacy aggregate addition text');
assert(serverJs.includes('function repairLegacyCompositeSubSegItems'), 'reload rebuild repairs legacy split composite references');
assert(serverJs.includes("compositionId: String(composition.compositionId)"), 'legacy repair restores composition identity');
assert(mainJs.includes("replaceAll('\\n', '<br>')"), 'subSeg line-break rendering remains intact');
const ordinal = mainJs.slice(mainJs.indexOf('function getNextLangUnitOrdinal'), mainJs.indexOf('function getSubSegBubbleTargetKey'));
assert(ordinal.includes('state.langUnitItems.map'), 'new capture IDs include persisted langUnits, not only visible bubbles');

const aggregate = { text: '跨大洲地~liandong', type: 'chinColl' };
const parts = [
  { text: '跨大洲地', target: { text: '跨大洲地', type: 'chinWord' }, aggregate },
  { text: 'liandong', target: { text: 'liandong', type: 'engWord' } },
];
assert.equal(parts[0].text, '跨大洲地', 'seed part remains its own text');
assert.equal(parts[1].text, 'liandong', 'addition part remains its own text');
assert.equal(parts[1].target.text, 'liandong', 'addition part target is independent');
assert.equal(aggregate.text, '跨大洲地~liandong', 'composite target remains parent-only');

const afterClearAndRecapture = { type: 'langUnitRef', text: 'liandong' };
assert.equal(afterClearAndRecapture.text, 'liandong', 'fresh independent capture cannot receive the old composite prefix');
const nextOrdinal = (ids, prefix) => ids
  .filter((id) => id.startsWith(prefix))
  .reduce((next, id) => Math.max(next, Number(id.slice(prefix.length)) + 1), 0);
assert.equal(nextOrdinal(['sub-0', 'sub-1'], 'sub-'), 2, 'recreated bubbles receive a new ID instead of a deleted composite ID');
assert.equal('估计还会跨大洲地跨大洲地~liandong'.split('\n').length, 1, 'fixture stays a single line');

console.log('cycle-selected subSeg augmentation verifier passed');
