# Git

Measures commit messages and repository hygiene. commitlint reads each of the last 50 commits with the conventional rules, and `git diff --check` reads whitespace. `UPHILL_GIT_COMMITS` sets the number of commits to read.

Whitespace reflects tracked files in the working tree. Commit checks reflect the named commit. `fix-tests` looks for a changed test source path, not proof of regression coverage. The English lexicon checks the form of the opening verb and skips words it cannot classify.

Its metrics go into the shared categories `style` and `commits`. Each merges with the category of its name in the project and its other packs.

## Requirements

- **Bun:** Runs the script and installs commitlint from the pack's lockfile.
- **Git:** A clone with enough history for the commits it reads.

## Add

```sh
# Pin the pack, and approve the install of its dependencies.
uphill add wevm/uphill/packs/git@main
```
