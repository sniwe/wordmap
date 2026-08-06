# System use summary — 2026-07-27

## Purpose

This is a language-learning investigation system. A learner listens to target-language audio, marks an audio interval, transcribes what they hear or understand, then targets uncertain or interesting spans for deeper investigation and notes.

    audEp
    └── audSeg
        └── subSeg
            └── langUnit
                └── linked child subSegs

## Collection relationships

- audEp is the source audio episode.
- audSeg is a selected interval inside an episode; audSeg.audEpId links it to the episode and tcs/tce store its time bounds.
- A root subSeg is the learner's transcription line for an audSeg.
- A non-root subSeg is a follow-up line opened from a targeted langUnit.
- subSeg.parentSubSegId identifies the owning row.
- subSeg.linkTargetLangUnitId identifies the bubble that opened the child.
- subSeg.content stores text tokens and lightweight langUnitRef pointers.
- langUnit owns reusable target text, target classification, and occurrence/context metadata.
- Empty child subSeg rows are investigation scaffolds; their links exist even before the learner writes content.

## Concrete episode and segment mapping

Episode:

    audEp: 767e5d96-9f62-45f4-89a5-f98c43303144
    title: 955｜2026下半年，哪些东西可能要涨价？

Relevant ordered segments:

    audSeg ...-6: 49.558243–60.005479
    audSeg ...-7: 64.954919–77.433796
    audSeg ...-8: 77.729313–80.059056

### Transcription and uncertain target

Root transcription:

    subSeg: 767e5d96-9f62-45f4-89a5-f98c43303144-6-0
    audSegId: ...-6
    text: 机构是把厄尔尼诺分成4挡的，分别是：弱，中，强，超强

Its targeted span is:

    langUnit: ...-6-0-0
    text: 把厄尔尼诺分成4dang
    target.type: chinFuzz
    context.type: chinPhrase

The learner heard or transcribed 4dang uncertainly. Its child branch supplies candidate interpretations for dang, including 一档 and 挂档; one option is marked with = as the current best selection. The selected option can then open descendants investigating 挡 and related usages or associations.

    uncertain hearing: 4dang
    └── candidate options: 一档 / 挂档
        └── selected option (=)
            └── further investigation of 挡

### Meaning guess / uncertainty note

The 传闹连 branch is a separate example:

    parent target langUnit: ...-7-0-0
    text: chuannaolian

    child subSeg: 767e5d96-9f62-45f4-89a5-f98c43303144-7-1
    parentSubSegId: ...-7-0
    linkTargetLangUnitId: ...-7-0-0

    content:
      langUnitRef -> ...-7-1-0, text 传闹连
      text         -> " transfer chaos chain?"

This is an approximate Chinese transcription followed by an off-the-top-of-the-head meaning guess. The question mark records low confidence. It is a question/comment or uncertainty prompt, not a confirmed translation.

## Composition logic

langUnit.compositions records learner-idiosyncratic explanations of how parts combine. Each composition has a seed unit, added parts, positions, and target classifications.

Existing examples include:

    59926090-45fb-440c-b7ef-6f5c63195543
      消息 + 升级了

    761ceed8-c889-4c39-aadf-0583db905739
      消息 + 升级了

    f3702686-3efd-4624-9ebe-349bea31074a
      超过 + 史上最强记录

    ee2de915-055d-4f30-ae3c-050f494cad35
      什么是 + 你

    9e525c22-7dc8-4e54-b5f4-33a0b0de5c13
      什么是 + 不陌生

These are composition-logic notes, and their added expressions may also serve as useful target-language examples.

## Note functions

These functions are composable rather than mutually exclusive:

| Function | Concrete manifestation |
| --- | --- |
| Question/comment | transfer chaos chain? records uncertainty and prompts investigation. |
| Useful target-language example | Candidate usages/options and descendant examples attached to a target. |
| Composition logic | langUnit.compositions with seed/addition parts and positions. |
| Candidate options | Alternatives attached to the uncertain 4dang target, with = selecting one. |
| Association | Descendant investigation prompted by the selected 挡 interpretation. |

The resulting investigation path is:

    learner transcription
      → uncertain target
        → first guess or question
          → candidate options
            → selected best fit
              → examples, associations, and/or composition analysis

## Context inference order

Interpret context from most specific to least specific:

1. Immediate subSeg text and its parent/child links.
2. Neighboring audSeg transcriptions.
3. audEp title and episode metadata.

This is nearest-context-first, local-to-global inference. For example, the El Niño sentence in audSeg ...-6 is stronger evidence for interpreting 4dang than the episode title's broader pricing topic.

## Current data-state caveat

The current snapshot contains six subSeg records, only two with non-empty flattened text, and 34 langUnit records. Several child rows are empty scaffolds. The langUnit collection contains important option and composition relationships, so interpretation must inspect both collections rather than relying only on subSeg.text.
