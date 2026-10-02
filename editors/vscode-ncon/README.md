# vscode-ncon

Editor support for `.ncon` (docs/specs/ncon-format.md): highlighting, rainbow nesting by depth,
hover and go to definition for concepts, completion and signature help for the six top-level forms,
parse errors from the runtime's own parser, and Format Document with the runtime's own formatter.

Lifted from Napkin's extension, deliberately. Left behind: embedded JavaScript in `Code` bodies,
local-variable scopes (`Bind`), ghost operators, parameter-name hints, the syntax color style and
the saved-graph hover. None of them exist in Noodle's N-Con.

Format Document refuses a file with comments (comments are not data, so the formatter would drop
them): the seed is hand-edited and only checked.

## Use

```
pnpm build                       # the parser and formatter are loaded from dist/ncon
ln -s "$PWD/editors/vscode-ncon" ~/.vscode/extensions/noodle.vscode-ncon-0.1.0
```

Reload VS Code. Formatter from a shell: `node editors/vscode-ncon/format.js --check seed/*.ncon`.
Tests: `pnpm test:editor`.
