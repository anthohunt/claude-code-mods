# verification-avant-remontee — check before reporting

When a Claude Code session announces a result (« c'est fait », « déployé », « ça marche », « testé »…), this mod asks a
**fresh agent that did none of the work** to check every claim with its own tools, read-only. If the verifier disputes
a claim, the session gets one extra turn to correct it and say so, right after its original answer.

## How it works

1. At the end of a turn, the mod looks at the answer: at least 160 characters and containing a claim of result? The
   claim words it looks for are French (fait, terminé, corrigé, déployé, en ligne, fonctionne, vérifié, testé…); adapt the
   `AFFIRME` pattern in `hooks/register.ts` for another language. Otherwise nothing happens.
2. It launches the `verificateur` agent it registers (tools: Read, Grep, Glob, Bash, WebFetch; read-only by
   instruction). The model itself cannot launch this agent: only the mod does.
3. The verifier ends its report with `VERDICT-REMONTEE: OK`, or `VERDICT-REMONTEE: CONTESTE` followed by each disputed
   claim and what it saw instead.
4. On a dispute, the session is prompted once to correct its answer. That correction is not checked again: one check,
   at most one correction per answer.

Something the verifier cannot check from where it runs (another machine, the user's screen) is reported as such, not
as a dispute.

## Install

```bash
claude --plugin-dir ./verification-avant-remontee
claude plugin validate ./verification-avant-remontee
claude plugin test ./verification-avant-remontee      # 5 tests
```

No option. Written against Claude Code 2.1.x (mods are an early-access API). Code comments are in French.
