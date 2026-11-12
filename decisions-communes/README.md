# decisions-communes — shared decisions

One Markdown file of rules you decided once ("never push on Friday", "this address for every public commit"…). The mod
rereads it at every request and adds it to the prompt of the session. Sync the file between your machines and a
decision taken in one session reaches all the others, everywhere.

## Option

`fichiers` — path of the file (default `~/.claude/decisions-communes.md`). Several paths can be given, separated by `;`:
the first one that exists is used. `~` is your home folder. Set it in `/config` or under
`pluginConfigs["decisions-communes@inline"].options` in your Claude Code settings.

The mod does not create the file: write it by hand or from a manager session, and sync it however you like (git,
Syncthing, a shared folder). Only the last 6,000 characters are added to the prompt, so keep the newest decisions at the
bottom.

## Install

```bash
claude --plugin-dir ./decisions-communes
claude plugin validate ./decisions-communes
claude plugin test ./decisions-communes      # 3 tests
```

Written against Claude Code 2.1.x (mods are an early-access API). Code comments are in French.
