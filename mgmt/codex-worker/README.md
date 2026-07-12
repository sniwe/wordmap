# Codex Worker

Minimal worker for `discern-languageUnit-root`.

## Input

One request is a JSON object with:

```json
{
  "task": "root | contextType",
  "context": "string",
  "target": "string",
  "substring": "string"
}
```

Accepted forms:

- stdin JSON
- one inline argv JSON payload
- one JSON object per line in tty mode

## Output

Success goes to stdout only:

```json
{ "res": "langUnitRoot" }
```

For `task: "contextType"`, `res` is `chinWord` or `chinPhrase`.

Diagnostics go to stderr.

## Scripts

- `npm run dev`
- `npm start`
- `npm test`

## Notes

- The worker keeps one Node process alive.
- It reuses one Codex thread id by resuming the last session.
- Interactive `npm run dev` and `npm start` launches send a startup `test` probe first; use the worker after that completes.
- Set `CODEX_BIN` if the local `codex` command is not on PATH.
