## What to build

Cancel on the `New Task` sheet throws away whatever the user typed with no warning. When the draft has a title, Cancel asks first.

## Acceptance criteria

- [ ] On `New Task` with a title typed, tapping Cancel shows "Discard this task?" with `Discard` and `Keep editing`; the sheet stays open until one is chosen.
- [ ] `Keep editing` returns to the sheet with the title kept; `Discard` closes the sheet and adds nothing to Today.
- [ ] With an empty title, Cancel closes the sheet at once, as today.
- [ ] `ChecklistItemCopy` holds the three new strings, with tests.

## Blocked by

None.
