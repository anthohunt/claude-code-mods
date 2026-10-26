# modes-reponse — persistent answer modes

`/tldr` turns on the short-answer mode (1–3 sentences, result first, no preamble or unrequested options); `/tldr off` turns it off.
`/mode-simple` turns on the plain-language mode (name things by what they do, translate jargon on first use, example before the rule,
end with the "so what"). Both modes persist between sessions and add their instruction to the system prompt of every message while on;
the status line shows which one is active.
