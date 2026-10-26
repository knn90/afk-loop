## What to build

Onboarding is the last screen flow that still speaks of habits (deferred from #182, see `PRODUCT.md`). Rewrite its copy so a first-run user reads about a daily checklist of tasks.

Confirmed strings:

| Old | New |
|---|---|
| Small habits, big change | Small tasks, done daily |
| You don't rise to your goals — you fall to your systems. Start by casting a vote for the person you want to become. | A short list you check off every day. Start with a few tasks that matter to you. |
| Pick your first habits | Pick your first tasks |
| Reminders help you show up at the right moment. We'll only nudge you for the habits you chose. | Reminders help you show up at the right moment. We'll only nudge you for the tasks you chose. |
| Something went wrong saving your habits. Please try again. | Something went wrong saving your tasks. Please try again. |

## Decisions

- `OnboardingCopy` holds every onboarding string, not just the five above: button titles ("Continue", "Back", "Allow reminders", "Maybe later"), "Choose 1–3 to start. You can always add more later.", "A gentle nudge?" and the preview name. `OnboardingView` inlines none. Shape follows `TodayCopy`.
- Starter task titles stay in `StarterChecklistItem.catalog`.
- Tests pin only the five task-bearing strings; unchanged strings such as "Back" and "Continue" are not pinned.
- "No user-facing habit remains" is proven by a one-off grep reported in the PR; no standing guard test or lint.

## Acceptance criteria

- [ ] Onboarding shows the confirmed strings; no user-facing "habit" remains in the app.
- [ ] All onboarding copy lives in `OnboardingCopy`, with tests on the five task-bearing strings.
- [ ] `PRODUCT.md` no longer says onboarding copy is deferred.
- [ ] Starter task catalog, step order and behaviour unchanged.

## Blocked by

None.

