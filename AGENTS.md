<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->
EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.
DO NOT STOP TO ASK "SHOULD I PROCEED?" — PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.
IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.

# Overview

You possess highly advanced problem-solving capabilities, but you may sometimes become overly absorbed in a problem—a “rabbit hole”—in pursuit of a perfectly complete conclusion. To ensure practical and timely feedback, strictly follow the **Heuristic & Validation Limits** below.

## Comments

Most important elements—including code lines, modules, and files—require comments to support code review, debugging, and refactoring.

Each comment should address the following:

1. What dependencies the element requires
2. Which other elements it interacts with
3. Why the element is necessary
4. How it works and what outcome it produces

Comments should not be excessively detailed, but they should not be so broad that they become unhelpful.

Add comments only after considering the maintenance-efficiency trade-off: the value of the comment should justify the cost of maintaining it.

## The Inefficiency of Over-Fixation

1. Do not spend too much time trying to solve a single problem. The maximum number of attempts is three.

Remember that failure is the mother of success. If a problem appears difficult to resolve within the current session, leave an insight that introduces a perspective different from the approaches already attempted, hand the problem off to another session, and continue with other work.

2. Attempting to validate every minor issue can reduce both efficiency and overall consistency.

In some cases, an appropriate heuristic produces better results than exhaustive validation.

## Solutions

* Do not attempt to write code that perfectly covers every edge case. First provide the most intuitive and generally applicable solution that satisfies at least 80% of the user’s requirements.

* Do not investigate excessively deep root causes, such as internal bugs in a specific library or framework. When an immediately applicable workaround or heuristic-based alternative exists, prioritize it.

* When progress is blocked by insufficient information, do not repeatedly question the user or wait until a perfect logical model can be established. Assume the most probable general scenario as a heuristic and develop the answer fully based on that assumption. However, clearly state the assumptions you made.

* Do not attempt internal self-correction more than three times to resolve the same error or logical contradiction. If a perfect solution is not found within three attempts, stop validating. Conclude the response by presenting the currently identified limitations of the problem and the best available imperfect alternative.

* Apply strict logical or mathematical validation only to the user-defined critical path. For extreme edge cases with a probability of occurrence below 1%, or for secondary performance optimizations, omit exhaustive validation and use heuristics instead.

* When you recognize a dilemma in which two or more conditions conflict and complete logical consistency cannot be achieved, stop validation immediately. Do not force a contrived solution. Present only the trade-offs of each option and leave the final decision to the user.

<!-- END AUTONOMY DIRECTIVE -->

## NAIS workspace source of truth

- The canonical working checkout is `E:\AI_Project_Library\projects\nais\nais_blue`.
- Run repository searches, edits, installs, builds, and tests from that E-drive checkout.
- Do not use a C-drive or OneDrive NAIS checkout, mirror, cache, or generated guidance as a source of truth; those project copies are legacy unless the user explicitly reactivates one.
- Historical NAIS integration plans and documents are legacy reference material by default. The current E-drive runtime code, current user direction, and freshly passing tests take precedence.
- For Composition Domain work, `docs/composition-v2/**` is phase guidance, but it never overrides observed current runtime behavior or current user direction.
- The canonical upstream is the `origin` remote at `https://github.com/JaCha00/nais_blue.git`; the retired private review repository must not be restored as a remote or release authority.
- These rules govern project/source locations. External toolchains may remain installed elsewhere when the build explicitly requires them.
