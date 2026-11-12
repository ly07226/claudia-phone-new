# Issue #14 source and feedback audit

The app uses the supplied `aaaa.docx` only for Sweet Talk and `qqqa.docx` only for Dirty Talk. `phaseTalkSources.ts` archives every paragraph in order, including empty paragraphs and the non-instruction heading. Instruction text is not trimmed or rewritten. Word-generated list numbers are metadata, rendered separately from the paragraph text.

| Original | SHA-256 | Red | Yellow | Green | Total occurrences |
| --- | --- | ---: | ---: | ---: | ---: |
| aaaa.docx | 995c47f15d676d4b264da3a4ed69e970679d72beb0126e69fea38c83597520f4 | 7 | 33 | 40 | 80 |
| qqqa.docx | 4218917802fee359c7672bbfca845c1b6c0ae0a802ffa9c348950da570b2b6cd | 5 | 9 | 53 | 67 |

Classification is separate metadata: red for static/waiting/observing or speech without ongoing movement, yellow for slowing/intermittent actions, green for active actions. Dirty paragraph 112 is an extraction heading, archived but not drawn. Dirty paragraphs 126 and 128 repeat paragraphs 9 and 10 exactly. All occurrences remain archived; runtime avoids weighting exact duplicates twice (65 unique Dirty instructions). Word automatic numbers at paragraphs 33, 53, 71, 91 and 111 are checked against numbering.xml.

Run the read-only original-file audit:

```sh
python scripts/verify-phase-talk.py /path/to/aaaa.docx /path/to/qqqa.docx
```

Default group selection is exclusive. Each selected group draws only its own phase. With neither selected, the previous base/custom instruction behavior remains available. Character libraries, user cards and legacy history remain local and separate. No generation request is made during gameplay.

Random strategy: every non-green stage is followed by green. Green can continue with probability .60 (maximum three consecutive stages); otherwise yellow/red are weighted .25/.15. The 100,000-stage seeded regression checks approximately 66% green stages, 21% yellow, 13% red, no adjacent non-green stages and the three-green cap. These percentages refer to stage counts, not time; durations remain user-controlled.

All active feedback originates from the same integrated BPM beat event. Manual changes use the effective current BPM and disable automatic ramping. The orb animation duration also follows BPM. Red cancels feedback without suspending the unlocked audio context; pause, background, exit and deadline suspend it. Reduced-motion disables animation. Saved volume is unchanged; oscillator gain is increased from .15 to .30 times the user's volume.

History is collapsed by default and scrolls internally when expanded. Legacy and current history are merged without deleting distinct entries; restore appends the current library before replacing it. No silent history pruning. Storage keeps its existing v1 format, atomic save and 3 MiB guard; history has a validation ceiling of 1000 snapshots, with safe save failure instead of deleting old history. This app's localStorage remains outside existing ZIP backup coverage; no backup format is changed here.

Validation: 50 mini-app tests and 108 existing chat regressions pass using Mock requests. Existing chat tests were synchronized only for the already-present desktop pagination and existing HTTP-200 content-filter error detail. No chat, Story, Provider or memory implementation changes. Screenshots are browser-rendered iPhone-width Chromium views; real iPhone Safari audio, vibration and standalone behavior still require device acceptance. No paid API was called.
