#!/usr/bin/env python3
"""Static verification for the frontend, for use when npm/vite are unavailable.

Checks that would otherwise be caught by a bundler + linter:
  1. every relative import resolves to a real file
  2. every default/named import matches what the target module exports
  3. every className used in JSX has a matching CSS rule
  4. every var(--token) is defined
  5. every <Icon name="..."> exists in the icon map
  6. brackets and quotes balance in every file (catches truncated writes)
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"

failures: list[str] = []
notes: list[str] = []


def fail(message: str) -> None:
    failures.append(message)


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


js_files = sorted(p for p in SRC.rglob("*") if p.suffix in {".js", ".jsx"})
css_files = sorted(SRC.rglob("*.css"))
sources = {p: p.read_text(encoding="utf-8") for p in js_files + css_files}

# --- 1 & 2: imports resolve, and names actually exist ----------------------

IMPORT_RE = re.compile(
    r"""^import\s+(?P<clause>[^'"]*?)\s*from\s*['"](?P<spec>[^'"]+)['"]""",
    re.MULTILINE,
)
BARE_IMPORT_RE = re.compile(r"""^import\s*['"](?P<spec>[^'"]+)['"]""", re.MULTILINE)

EXPORT_DEFAULT_RE = re.compile(r"^export\s+default\b", re.MULTILINE)
EXPORT_NAMED_RE = re.compile(
    r"^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)", re.MULTILINE
)
EXPORT_LIST_RE = re.compile(r"^export\s*\{([^}]*)\}", re.MULTILINE)


def resolve(importer: Path, spec: str) -> Path | None:
    if not spec.startswith("."):
        return None  # bare package specifier — resolved by node, not our concern
    base = (importer.parent / spec).resolve()
    if base.is_file():
        return base
    for suffix in (".js", ".jsx", ".json", ".css"):
        candidate = base.with_name(base.name + suffix)
        if candidate.is_file():
            return candidate
    for index in ("index.js", "index.jsx"):
        candidate = base / index
        if candidate.is_file():
            return candidate
    return None


def exported_names(path: Path) -> tuple[bool, set[str]]:
    text = sources.get(path, "")
    names = set(EXPORT_NAMED_RE.findall(text))
    for group in EXPORT_LIST_RE.findall(text):
        for piece in group.split(","):
            piece = piece.strip()
            if not piece:
                continue
            names.add(piece.split(" as ")[-1].strip())
    return bool(EXPORT_DEFAULT_RE.search(text)), names


imported_files: set[Path] = set()

for path in js_files:
    text = sources[path]

    for match in BARE_IMPORT_RE.finditer(text):
        spec = match.group("spec")
        if spec.startswith("."):
            target = resolve(path, spec)
            if target is None:
                fail(f"{rel(path)}: side-effect import '{spec}' does not resolve")
            else:
                imported_files.add(target)

    for match in IMPORT_RE.finditer(text):
        spec = match.group("spec")
        clause = match.group("clause").strip()
        if not spec.startswith("."):
            continue

        target = resolve(path, spec)
        if target is None:
            fail(f"{rel(path)}: import '{spec}' does not resolve to a file")
            continue
        imported_files.add(target)
        if target.suffix == ".css":
            continue

        has_default, names = exported_names(target)

        named_part = ""
        default_part = clause
        if "{" in clause:
            default_part, _, rest = clause.partition("{")
            named_part, _, _ = rest.partition("}")

        default_name = default_part.strip().rstrip(",").strip()
        if default_name and not has_default:
            fail(f"{rel(path)}: '{spec}' has no default export (imported as {default_name})")

        for piece in named_part.split(","):
            piece = piece.strip()
            if not piece:
                continue
            source_name = piece.split(" as ")[0].strip()
            if source_name not in names:
                fail(f"{rel(path)}: '{spec}' does not export '{source_name}'")

entrypoints = {SRC / "main.jsx"}
for path in js_files:
    if path not in imported_files and path not in entrypoints:
        notes.append(f"unreferenced module: {rel(path)}")

# --- 3: classNames have CSS rules ----------------------------------------

css_text = "\n".join(sources[p] for p in css_files)
# Strip comments first: a comment mentioning a filename like "app.css" otherwise
# registers ".css" as a defined class and pollutes the unused-class note.
css_rules = re.sub(r"/\*.*?\*/", " ", css_text, flags=re.DOTALL)
defined_classes = set(re.findall(r"\.(-?[_a-zA-Z][\w-]*)", css_rules))

CLASSNAME_RE = re.compile(r"className=(?:\{`([^`]*)`\}|\{?\"([^\"]*)\"\}?)")
# Inside a template literal, only the branches of a ternary are class names —
# `${x === "indexing" ? "is-indeterminate" : ""}` contributes the second, not
# the first.
TERNARY_BRANCH_RE = re.compile(r"[?:]\s*\"([^\"]*)\"")
used_classes: dict[str, str] = {}

for path in js_files:
    for match in CLASSNAME_RE.finditer(sources[path]):
        raw = match.group(1) or match.group(2) or ""
        harvested = []
        for expression in re.findall(r"\$\{([^}]*)\}", raw):
            harvested.extend(TERNARY_BRANCH_RE.findall(expression))
        # `dropzone-${variant}` leaves a dangling stem, which is not a class.
        static = re.sub(r"\S*\$\{[^}]*\}\S*", " ", raw)
        for token in (static + " " + " ".join(harvested)).split():
            used_classes.setdefault(token, rel(path))

for name, where in sorted(used_classes.items()):
    if name not in defined_classes:
        fail(f"{where}: class '{name}' is used in JSX but has no CSS rule")

unused = sorted(defined_classes - set(used_classes))
if unused:
    notes.append(f"CSS classes with no JSX usage ({len(unused)}): {', '.join(unused)}")

# --- 4: CSS custom properties are defined --------------------------------

declared_tokens = set(re.findall(r"^\s*(--[\w-]+)\s*:", css_text, re.MULTILINE))
for token in sorted(set(re.findall(r"var\((--[\w-]+)", css_text))):
    if token not in declared_tokens:
        fail(f"css: var({token}) is used but never declared")

# --- 5: icon names exist -------------------------------------------------

icon_source = sources.get(SRC / "components" / "Icon.jsx", "")
icon_names = set(re.findall(r"^\s{2}(\w+):", icon_source, re.MULTILINE))
if not icon_names:
    fail("Icon.jsx: could not read the icon map")
else:
    for path in js_files:
        for name in re.findall(r"<Icon[^>]*?name=\"(\w+)\"", sources[path], re.DOTALL):
            if name not in icon_names:
                fail(f"{rel(path)}: <Icon name=\"{name}\"> is not in the icon map")

# --- 6: brackets and quotes balance --------------------------------------

PAIRS = {"(": ")", "[": "]", "{": "}"}

# A '/' starts a regex literal (rather than division) when the previous
# meaningful token cannot end an expression.
REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>") | {""}
REGEX_KEYWORDS = {"return", "typeof", "case", "in", "of", "do", "else", "yield", "await", "new"}


def starts_regex(text: str, index: int) -> bool:
    # `</` opens a JSX closing tag and `/>` ends a self-closing one. Neither is a
    # regex, and `<` happens to sit in REGEX_PRECEDERS, so without these two
    # guards every `</div>` was read as the start of a regex literal — quietly
    # erasing the slash (and sometimes more) from the text being checked.
    if index > 0 and text[index - 1] == "<":
        return False
    if text.startswith("/>", index):
        return False

    cursor = index - 1
    while cursor >= 0 and text[cursor] in " \t\n\r":
        cursor -= 1
    if cursor < 0:
        return True
    previous = text[cursor]
    if previous in REGEX_PRECEDERS:
        return True
    if previous.isalnum() or previous == "_":
        start = cursor
        while start >= 0 and (text[start].isalnum() or text[start] == "_"):
            start -= 1
        return text[start + 1 : cursor + 1] in REGEX_KEYWORDS
    return False


def skip_regex(text: str, index: int) -> int:
    """Return the index just past a regex literal beginning at `index`."""
    cursor = index + 1
    in_class = False
    while cursor < len(text):
        char = text[cursor]
        if char == "\\":
            cursor += 2
            continue
        if char == "\n":
            return index + 1  # not a regex after all; treat as division
        if char == "[":
            in_class = True
        elif char == "]":
            in_class = False
        elif char == "/" and not in_class:
            cursor += 1
            while cursor < len(text) and text[cursor].isalpha():
                cursor += 1  # flags
            return cursor
        cursor += 1
    return index + 1


def balance(text: str, path: Path) -> None:
    stack: list[tuple[str, int]] = []
    line = 1
    index = 0
    length = len(text)

    while index < length:
        char = text[index]
        if char == "\n":
            line += 1
            index += 1
            continue
        if char == "\\":
            index += 2
            continue
        # comments
        if text.startswith("//", index) and path.suffix != ".css":
            index = text.find("\n", index)
            if index == -1:
                break
            continue
        if text.startswith("/*", index):
            end = text.find("*/", index + 2)
            if end == -1:
                fail(f"{rel(path)}:{line}: unterminated block comment")
                break
            line += text.count("\n", index, end)
            index = end + 2
            continue
        if char == "/" and path.suffix != ".css" and starts_regex(text, index):
            end = skip_regex(text, index)
            line += text.count("\n", index, end)
            index = end
            continue
        if char in "\"'`":
            quote = char
            index += 1
            while index < length:
                if text[index] == "\\":
                    index += 2
                    continue
                if text[index] == "\n":
                    line += 1
                    if quote != "`":
                        break  # unterminated single-line string
                if text[index] == quote:
                    index += 1
                    break
                index += 1
            continue
        if char in PAIRS:
            stack.append((char, line))
        elif char in PAIRS.values():
            if not stack:
                fail(f"{rel(path)}:{line}: unexpected closing '{char}'")
                return
            opener, opened_at = stack.pop()
            if PAIRS[opener] != char:
                fail(
                    f"{rel(path)}:{line}: '{char}' closes '{opener}' opened on line {opened_at}"
                )
                return
        index += 1

    if stack:
        opener, opened_at = stack[-1]
        fail(f"{rel(path)}:{opened_at}: '{opener}' is never closed")


for path, text in sources.items():
    balance(text, path)

# --- 8: JSX tags are balanced --------------------------------------------
# Node can syntax-check plain .js, but nothing here can parse JSX, so tag
# nesting is checked directly. Unclosed or mismatched tags are the likeliest
# way a hand edit breaks a component.

VOID_SAFE = re.compile(r"<([A-Za-z][\w.$]*)")
CLOSER = re.compile(r"</\s*([A-Za-z][\w.$]*)?\s*>")


def blank_out(text: str, path: Path) -> str:
    """Replace strings, comments and regex literals with spaces, keeping offsets."""
    out = list(text)
    index = 0
    length = len(text)

    def erase(start: int, end: int) -> None:
        for position in range(start, min(end, length)):
            if out[position] != "\n":
                out[position] = " "

    while index < length:
        char = text[index]
        if text.startswith("//", index):
            end = text.find("\n", index)
            end = length if end == -1 else end
            erase(index, end)
            index = end
            continue
        if text.startswith("/*", index):
            end = text.find("*/", index + 2)
            end = length if end == -1 else end + 2
            erase(index, end)
            index = end
            continue
        if char == "/" and starts_regex(text, index):
            end = skip_regex(text, index)
            erase(index, end)
            index = end
            continue
        if char in "\"'`":
            quote = char
            cursor = index + 1
            while cursor < length:
                if text[cursor] == "\\":
                    cursor += 2
                    continue
                if text[cursor] == quote:
                    cursor += 1
                    break
                if text[cursor] == "\n" and quote != "`":
                    break
                cursor += 1
            erase(index, cursor)
            index = cursor
            continue
        index += 1

    return "".join(out)


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def check_jsx(text: str, path: Path) -> None:
    clean = blank_out(text, path)
    stack: list[tuple[str, int]] = []
    index = 0
    length = len(clean)

    while index < length:
        if clean[index] != "<":
            index += 1
            continue

        if clean.startswith("<>", index):
            stack.append(("<>", index))
            index += 2
            continue

        closing = CLOSER.match(clean, index)
        if closing:
            name = closing.group(1) or "<>"
            if not stack:
                fail(f"{rel(path)}:{line_of(text, index)}: </{name}> closes nothing")
                return
            opened, opened_at = stack.pop()
            if opened != name:
                fail(
                    f"{rel(path)}:{line_of(text, index)}: </{name}> closes "
                    f"<{opened}> opened on line {line_of(text, opened_at)}"
                )
                return
            index = closing.end()
            continue

        opener = VOID_SAFE.match(clean, index)
        if not opener:
            # A bare '<' here is a comparison operator, not a tag.
            index += 1
            continue

        cursor = opener.end()
        depth = 0
        while cursor < length:
            char = clean[cursor]
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
            elif char == ">" and depth == 0:
                break
            cursor += 1

        if cursor >= length:
            fail(f"{rel(path)}:{line_of(text, index)}: <{opener.group(1)} is never closed with '>'")
            return

        if clean[cursor - 1] != "/":
            stack.append((opener.group(1), index))
        index = cursor + 1

    if stack:
        name, opened_at = stack[-1]
        fail(f"{rel(path)}:{line_of(text, opened_at)}: <{name}> is never closed")


for path, text in sources.items():
    if path.suffix in {".jsx", ".js"}:
        check_jsx(text, path)

# --- report --------------------------------------------------------------

print(f"checked {len(js_files)} JS/JSX files and {len(css_files)} stylesheets")
print(f"  {len(used_classes)} classNames used, {len(defined_classes)} defined in CSS")
print(f"  {len(declared_tokens)} design tokens, {len(icon_names)} icons")

for note in notes:
    print(f"NOTE  {note}")

if failures:
    print(f"\nFAILURES ({len(failures)}):")
    for problem in failures:
        print(f"  - {problem}")
    sys.exit(1)

print("\nFAILURES: none")
