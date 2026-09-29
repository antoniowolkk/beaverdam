# ADR-0001: beaverdam is published from the antoniowolkk GitHub account

- **Status:** Accepted
- **Date:** 2026-09-29
- **Deciders:** Antonio Wolkk

## Context

The maintainer's machine is logged in to GitHub with two accounts: `antoniowolkk` and `drowsyfella`. `gh` keeps one of them active for every repo, and git asks `gh` or the keychain for a token. When `drowsyfella` was active, pushing to `antoniowolkk/beaverdam` failed with a 403. beaverdam is headed for a public repo under Antonio's name (AGENTS.md section 1), so who owns it and who pushes to it has to be clear.

## Decision

beaverdam lives at `github.com/antoniowolkk/beaverdam`, and every push, PR, release, and tag comes from the `antoniowolkk` account. This clone sets `credential.https://github.com.username = antoniowolkk` in its local git config, so git asks for that account's credentials by name. Before pushing, check that `gh auth status` shows `antoniowolkk` as active, or run `gh auth switch -u antoniowolkk`.

## Alternatives considered

- **Push from whichever account is active.** Rejected: that is how the 403 happened, and a push from the wrong account can land under the wrong name.
- **Give `drowsyfella` write access.** Rejected: it adds a second identity to a repo that should show one owner.
- **SSH remote with a per-account host alias.** Would work, but it needs a new SSH key setup. Worth revisiting if switching accounts by hand keeps causing problems.

## Consequences

**Good**
- One owner and one identity on the public history.

**Bad / accepted cost**
- `gh auth switch` changes the active account everywhere, not just for this repo. Other work may need to switch back.

**Follow-ups**
- None.

---
Rules: one page maximum. Numbered in sequence. Immutable once accepted — to change a decision, write a new ADR that supersedes this one and update the Status line above.
