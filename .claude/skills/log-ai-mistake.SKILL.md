---
name: log-ai-mistake
description: Record a real AI-generated mistake (buggy, insecure or sub-optimal code, contrast defects, state bugs, wrong assumptions) in AI_NOTES.md as it is caught, so AI_OPTIMIZATION_REPORT.md can be written honestly later. Use when the user says an AI output was wrong, or when you catch a flaw in earlier AI-generated code in this repo.
---

# Log an AI mistake

`AI_OPTIMIZATION_REPORT.md` is a graded deliverable. It must contain at least 2 specific, truthful examples of flawed AI output and how a human fixed them. These are hard to reconstruct later, so log each one when it happens.

## Steps
1. Gather the facts from the conversation, the diff or the user. If a fact is missing, ask one short question; **never invent or embellish**. If there is no real mistake, say so and write nothing.
2. Append an entry to `AI_NOTES.md` at the repo root (create the file with a `# AI mistakes log` heading if it doesn't exist), using this template:

```
## <short title> (YYYY-MM-DD)
- **Category:** client-side bypassable RBAC | insecure default | validation/coercion | contrast/accessibility | state sync / race | schema/SQL | test gap | hallucinated API | other
- **Where:** file(s) and function(s)
- **What the AI produced:** the flawed code or claim, in 1-3 sentences (a short snippet is fine)
- **Why it was wrong:** the concrete failure or attack (e.g. "POST from cURL as supervisor returned 200")
- **How it was caught:** review, test, manual check, evaluator-style probe
- **Human fix:** what was changed and why it is safer
- **Commit:** hash or message of the fixing commit (add after committing)
```
3. Keep entries factual and in plain language. Use today's date from the environment, not a guess.
4. Tell the user the entry was added and which section of `AI_OPTIMIZATION_REPORT.md` it feeds (section 2 flawed code, section 3 human refactoring, or section 4 defensive architecture).
