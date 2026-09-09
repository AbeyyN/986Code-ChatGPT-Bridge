# Contributing

Contributions are welcome when they preserve the project's safety model, user control, and browser compatibility goals.

## Development flow

1. Fork the repository and create a focused branch.
2. Keep permissions minimal and explain any new permission in the pull request.
3. Do not commit passwords, tokens, SSH keys, personal browser data, HAR captures, or proprietary service data.
4. Run the local checks described below.
5. Open a pull request with reproduction steps and test evidence.

## Local checks

```powershell
node --check extension/background.js
node --check extension/bridge-content.js
node --check extension/command.js
node --check extension/options.js
node --check extension/popup.js
python -m json.tool extension/manifest.json > $null
```

## Pull request expectations

Keep changes scoped. Document user-facing changes in `CHANGELOG.md`. Browser mutation changes should include explicit target-tab tests. Security-sensitive changes should explain failure behaviour and confirmation boundaries.
