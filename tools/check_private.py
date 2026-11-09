#!/usr/bin/env python3
"""Privacy guard: make sure nothing from a private project ends up in this public one.

This public project grew out of a private, personal project. Run this script
before every commit and push. It reads the private project at run time (this
file itself holds no private words, names, paths or field names), builds a
list of private terms from it, and searches everything that would be
published: the files git would commit, staged changes and the git history.

Usage
-----
    python tools/check_private.py --private-dir PATH [--project DIR]
                                  [--terms FILE] [--fields a,b,c] [--quiet]

    --private-dir  the private project's folder (required; it is only read)
    --project      the public project folder (default: the folder above tools/)
    --terms        the terms file (default: <project>/.private-terms.txt; that
                   default may be missing, but a file named here must exist)
    --fields       comma-separated top-level keys of the private config.js to
                   harvest; overrides any @fields line in the terms file
    --quiet        in the "To review" section, show only counts per term

PRIVATE terms (any hit makes the check fail)
    1. the private folder's own name
    2. for every *.html file directly in the private folder: its file name
       without the extension, and the text of its <title>
    3. strings harvested from the private folder's config.js: every string
       literal ('...', "..." or `...`) in the part of the file that belongs to
       each chosen top-level key: from the comment lines just above the key up
       to the next top-level key, comments included. Only "specific" strings
       are kept: 3 or more letters, or any non-ASCII character (so a lone
       emoji counts). Colours such as #aabbcc and strings of only digits or
       punctuation are dropped. Quoted property names that look like code
       ("fieldName": ...) are structure, not content, and are skipped.
       Numbers (not strings) are never harvested: add any private number,
       such as a map coordinate, as a '!' line.
    4. '!' lines in the terms file

Terms file format (keep it out of git: add it to .gitignore)
    # Comment lines and blank lines are ignored.
    @fields fieldOne, fieldTwo   the config.js keys to harvest
                                      (default: all top-level keys)
    !Placeholder Name                 an extra PRIVATE term
    @allow Placeholder Author         this exact private term may appear (for
                                      example the author's own name): its hits
                                      are listed for review instead of failing
    exampleword                       a REVIEW word: allowed, but every hit is
                                      listed so that a person looks at it

What is searched
    - Every file git would commit (.gitignore is respected): its path and its
      text. Without a .git folder, git runs with a temporary git folder outside
      the project, so nothing is written to the project; without git, a small
      built-in .gitignore matcher is used. Image, video, audio, font, archive
      and PDF files cannot be searched as text: they are listed to check by
      eye. Their raw bytes are still searched for longer terms, which finds
      text stored uncompressed, such as image metadata.
    - With a .git folder: staged changes that differ from the files on disk,
      and the history of all branches and tags (changed lines, including
      those new in merges; file names; commit messages), plus branch and tag
      names and annotated tag messages.
    Matching is a plain case-insensitive substring search (str.casefold).
    Curly quotes count as straight ones, emoji variation selectors are
    ignored, and a term is also found when written with escaped quotes
    (\\' or \\"), \\u escapes or HTML entities (&#39; &quot; &amp; &#x1f600; ...).

The terms file is never printed and the summary shows only counts. The hit
lists do show the matched terms: this report is for your own terminal only.

Exit codes: 0 = no private content found; 1 = private content found, or the
terms file itself would be committed; 2 = usage or configuration error, or
the git repository could not be read completely.
"""

from __future__ import annotations

import argparse
import bisect
import codecs
import html
import os
import re
import shutil
import string
import subprocess
import sys
import tempfile
import traceback
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import NamedTuple

DEFAULT_TERMS_NAME = '.private-terms.txt'
CONFIG_NAME = 'config.js'
EXCERPT_WIDTH = 120
SNIFF_BYTES = 8192
RAW_SEARCH_LIMIT = 16 * 1024 * 1024  # binary files up to this size are also searched byte by byte
BINARY_EXTENSIONS = frozenset((
    'png jpg jpeg gif webp avif bmp ico svgz heic '
    'mp4 webm mov m4v mkv avi mp3 wav ogg m4a aac flac '
    'woff woff2 ttf otf eot zip gz xz 7z pdf').split())
EXIT_OK, EXIT_PRIVATE, EXIT_USAGE = 0, 1, 2
CASE_INSENSITIVE_FS = sys.platform in ('win32', 'darwin')


class UsageError(Exception):
    """A problem with the command line or the inputs (exit code 2)."""


class GitError(Exception):
    """A git command failed."""


# ---------------------------------------------------------------------------
# Terms and matching
# ---------------------------------------------------------------------------

# Curly quotes match straight ones, and emoji variation selectors are ignored,
# so the same words typed slightly differently are still found.
_FOLD_TABLE = str.maketrans({
    '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '\u2032': "'",
    '\u201c': '"', '\u201d': '"', '\u201e': '"', '\u2033': '"',
    '\ufe0e': None, '\ufe0f': None,
})
_CONTROL_CHARS = [*range(32), *range(127, 160), 0x2028, 0x2029]
_CONTROL_TO_SPACE = str.maketrans({c: ' ' for c in _CONTROL_CHARS})
_CONTROL_TO_QUESTION = str.maketrans({c: '?' for c in _CONTROL_CHARS})


def fold(text: str) -> str:
    """Normalise text for case-insensitive matching (see _FOLD_TABLE)."""
    return text.casefold().translate(_FOLD_TABLE)


def clean(text: str) -> str:
    """Make a name safe to print (no control characters)."""
    return text.translate(_CONTROL_TO_QUESTION)


class Term(NamedTuple):
    text: str      # as written in the source; shown in the hit lists
    key: str       # folded form used for matching
    private: bool  # False: a review term


def make_term(text: str, private: bool) -> Term:
    return Term(text, fold(text), private)


_ENTITIES = {"'": ('&#39;', '&#x27;', '&apos;', '&rsquo;', '&#8217;'), '"': ('&quot;', '&#34;', '&#x22;')}
_DROP_VARIATION_SELECTORS = str.maketrans('', '', '\ufe0e\ufe0f')


def js_escaped(text: str) -> str:
    """Non-ASCII characters written as \\uXXXX escapes, as JSON tools often write them."""
    out = []
    for ch in text:
        code = ord(ch)
        if code < 128:
            out.append(ch)
        elif code <= 0xFFFF:
            out.append(f'\\u{code:04x}')
        else:  # a UTF-16 surrogate pair
            code -= 0x10000
            out.append(f'\\u{0xD800 + (code >> 10):04x}\\u{0xDC00 + (code & 0x3FF):04x}')
    return ''.join(out)


def written_forms(text: str) -> list[str]:
    """Other ways code often spells the same text: escaped in a string, or with HTML entities."""
    forms = []
    if any(ch in text for ch in '\\\'"'):
        slashed = text.replace('\\', '\\\\')
        forms += [slashed.replace("'", "\\'"), slashed.replace('"', '\\"'),
                  slashed.replace("'", "\\'").replace('"', '\\"')]
    if "'" in text:
        forms.append(text.replace("'", '\\u2019'))
    escaped = html.escape(text, quote=False)
    forms.append(escaped)
    for quote, entities in _ENTITIES.items():
        if quote in text:
            forms += [escaped.replace(quote, entity) for entity in entities]
    plain = text.translate(_DROP_VARIATION_SELECTORS)
    if not plain.isascii():
        forms += [js_escaped(plain),
                  ''.join(ch if ch.isascii() else f'&#{ord(ch)};' for ch in plain),
                  ''.join(ch if ch.isascii() else f'&#x{ord(ch):x};' for ch in plain)]
    key = fold(text)
    return [form for form in dict.fromkeys(forms) if fold(form) != key]


def search_terms(terms: list[Term]) -> list[Term]:
    """The terms plus their other written forms; a form is reported under its term's text."""
    found: dict[str, Term] = {}
    for term in terms:
        found.setdefault(term.key, term)
        for form in written_forms(term.text):
            found.setdefault(fold(form), Term(term.text, fold(form), term.private))
    return list(found.values())


def unique_terms(terms: list[Term]) -> list[Term]:
    """One entry per reported term (a term and its other written forms count once)."""
    seen: dict[tuple[str, bool], Term] = {}
    for term in terms:
        seen.setdefault((term.text, term.private), term)
    return list(seen.values())


@dataclass
class Hit:
    path: str
    line: int | None   # None: the term is in the name (file path, branch name)
    term: Term
    excerpt: str
    origin: str = ''   # '' (file on disk), 'staged', 'commit abc1234' or 'ref'
    sign: str = ''     # '+' added or '-' removed line, for git changes


def _match_span(line: str, key: str) -> tuple[int, int]:
    """Where key matches line (after folding), as offsets into line itself."""
    folded = line.lower() if line.isascii() else fold(line)
    if len(folded) == len(line):
        start = folded.find(key)
        return (start, start + len(key)) if start >= 0 and key else (0, 0)
    # Folding changed the length (a German sharp s becomes 'ss'): map positions back.
    pieces = [fold(ch) for ch in line]
    owner = [i for i, piece in enumerate(pieces) for _ in piece]
    pos = ''.join(pieces).find(key)
    if pos < 0 or not key:
        return 0, 0
    return owner[pos], owner[pos + len(key) - 1] + 1


def excerpt(line: str, key: str, width: int = EXCERPT_WIDTH) -> str:
    """At most `width` characters of the line, centred on the match."""
    line = line.translate(_CONTROL_TO_SPACE)
    start, end = _match_span(line, key)
    lead = len(line) - len(line.lstrip())
    line = line.strip()
    start, end = max(0, start - lead), max(0, end - lead)
    if len(line) <= width:
        return line
    room = width - 6  # space for '...' at both ends
    left = max(0, min((start + end) // 2 - room // 2, len(line) - room))
    right = left + room
    return ('...' if left else '') + line[left:right] + ('...' if right < len(line) else '')


def find_in_text(text: str, terms: list[Term]) -> list[tuple[int, Term, str]]:
    """(line number, term, excerpt) for every term on every line it appears on."""
    folded = fold(text)
    found: list[tuple[int, Term, str]] = []
    newlines: list[int] | None = None
    lines: list[str] = []
    for term in terms:
        pos = folded.find(term.key)
        while pos != -1:
            if newlines is None:
                newlines = [m.start() for m in re.finditer('\n', folded)]
                lines = text.split('\n')
            index = bisect.bisect_left(newlines, pos)  # number of newlines before the match
            found.append((index + 1, term, excerpt(lines[index], term.key)))
            if index >= len(newlines):
                break
            pos = folded.find(term.key, newlines[index] + 1)  # continue on the next line
    unique: dict[tuple[int, str, bool], tuple[int, Term, str]] = {}
    for item in found:  # a term and its other written forms on one line: one hit
        unique.setdefault((item[0], item[1].text, item[1].private), item)
    return sorted(unique.values(), key=lambda item: (item[0], item[1].key))


def find_in_path(name: str, terms: list[Term]) -> list[Term]:
    folded = fold(name)
    return unique_terms([term for term in terms if term.key in folded])


# ---------------------------------------------------------------------------
# The terms file
# ---------------------------------------------------------------------------

@dataclass
class TermsFile:
    private: list[str] = field(default_factory=list)
    review: list[str] = field(default_factory=list)
    allow: list[str] = field(default_factory=list)
    fields: list[str] | None = None
    problems: list[str] = field(default_factory=list)


def split_fields(text: str) -> list[str]:
    return [part.strip() for part in text.split(',') if part.strip()]


def decode_text(data: bytes) -> str:
    """Bytes to text: UTF-8 (a BOM is dropped) or UTF-16 with a BOM, as Windows Notepad may save."""
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode('utf-16', errors='replace')
    return data.decode('utf-8-sig', errors='replace')


def read_text_file(path: Path) -> str:
    return decode_text(path.read_bytes())


def read_terms_file(path: Path) -> TermsFile:
    """Parse the terms file. Problems are reported by line number only, never by content."""
    terms = TermsFile()
    try:
        text = read_text_file(path)
    except OSError as exc:
        raise UsageError(f'cannot read the terms file: {exc}') from exc
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('!'):
            if line[1:].strip():
                terms.private.append(line[1:].strip())
        elif line.startswith('@'):
            directive, _, rest = line[1:].replace('\t', ' ').partition(' ')
            directive, rest = directive.lower().rstrip(':'), rest.strip()
            if directive == 'fields' and split_fields(rest):
                terms.fields = (terms.fields or []) + split_fields(rest)
            elif directive == 'allow' and rest:
                terms.allow.append(rest)
            else:
                terms.problems.append(f'Terms file line {number}: unknown or empty @ line, ignored.')
        else:
            terms.review.append(line)
    return terms


# ---------------------------------------------------------------------------
# config.js: a small JavaScript tokenizer and string harvester
# ---------------------------------------------------------------------------

class Token(NamedTuple):
    kind: str     # 'str', 'tpl' (template literal text), 'comment', 'punct' or 'word'
    start: int    # offset in the source
    text: str     # decoded value for strings, the body for comments, else the raw text
    nested: bool  # True inside a template literal's ${...}


_SIMPLE_ESCAPES = {'n': '\n', 't': '\t', 'r': '\r', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'}
_LINE_BREAKS = '\n\r\u2028\u2029'
_LINE_END_RE = re.compile('[\n\r\u2028\u2029]')
_HEX2_RE = re.compile(r'[0-9a-fA-F]{2}')
_HEX4_RE = re.compile(r'[0-9a-fA-F]{4}')
_HEX_BRACED_RE = re.compile(r'\{([0-9a-fA-F]{1,6})\}')
_WORD_RE = re.compile(r'[\w$][\w$.]*')
_IDENT_RE = re.compile(r'[A-Za-z_$][\w$]*')
_SPLIT_LINES_RE = re.compile('[\r\n\u2028\u2029]+')
_CLOSERS = {'{': '}', '[': ']', '(': ')'}
# A quoted string inside a comment. The quotes must not touch a letter on the
# outside, so the apostrophe in a word like "it's" is not taken for a quote.
_COMMENT_STRING_RE = re.compile(
    r"""(?<!\w)(["'`])((?:\\[^\n]|\1(?=\w)|(?!\1)[^\\\n])*?)\1(?!\w)""")
# CSS colours: #rgb, #rgba, #rrggbb, #rrggbbaa, and rgb()/rgba()/hsl()/hsla() with numbers.
_COLOUR_RE = re.compile(r'#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})'
                        r'|(?:rgba?|hsla?)\(\s*[-+0-9.%,/\s]*(?:deg|turn|rad)?[-+0-9.%,/\s]*\)',
                        re.IGNORECASE)
# Characters that do not make a string specific: digits, punctuation, spaces,
# and invisible ones (combining marks such as emoji variation selectors,
# control and format characters). Symbols such as emoji, and unassigned code
# points (newer emoji on an older Python), do count.
_FILLER_CATEGORIES = frozenset('Nd Nl No Pc Pd Ps Pe Pi Pf Po Zs Zl Zp Mn Mc Me Cc Cf Cs'.split())


def read_escape(src: str, i: int) -> tuple[str, int]:
    """Decode the escape sequence whose backslash is at src[i]: (text, next offset)."""
    if i + 1 >= len(src):
        return '', len(src)
    c = src[i + 1]
    if c == '\r' and src.startswith('\n', i + 2):
        return '', i + 3  # line continuation
    if c in _LINE_BREAKS:
        return '', i + 2  # line continuation
    if c == 'x' and _HEX2_RE.fullmatch(src, i + 2, i + 4):
        return chr(int(src[i + 2:i + 4], 16)), i + 4
    if c == 'u':
        braced = _HEX_BRACED_RE.match(src, i + 2)
        if braced and int(braced.group(1), 16) <= 0x10FFFF:
            return chr(int(braced.group(1), 16)), braced.end()
        if _HEX4_RE.fullmatch(src, i + 2, i + 6):
            return chr(int(src[i + 2:i + 6], 16)), i + 6
    return _SIMPLE_ESCAPES.get(c, c), i + 2


def join_surrogates(text: str) -> str:
    """Combine escaped UTF-16 surrogate pairs (an emoji written as two \\u escapes)."""
    if not any('\ud800' <= ch <= '\udfff' for ch in text):
        return text
    try:
        return text.encode('utf-16-le', 'surrogatepass').decode('utf-16-le')
    except UnicodeDecodeError:
        return text


def decode_escapes(text: str) -> str:
    if '\\' not in text:
        return text
    parts, i = [], 0
    while i < len(text):
        if text[i] == '\\':
            decoded, i = read_escape(text, i)
            parts.append(decoded)
        else:
            parts.append(text[i])
            i += 1
    return join_surrogates(''.join(parts))


class JsLexer:
    """Splits JavaScript source into the few token kinds the harvester needs."""

    def __init__(self, src: str):
        self.src = src
        self.tokens: list[Token] = []

    def tokenize(self) -> list[Token]:
        self._lex(0, nested=False)
        return self.tokens

    def _add(self, kind: str, start: int, text: str, nested: bool) -> None:
        self.tokens.append(Token(kind, start, text, nested))

    def _lex(self, i: int, nested: bool) -> int:
        """Tokenize from offset i. Inside ${...} (nested), return after its closing brace."""
        src, n = self.src, len(self.src)
        depth = 0
        while i < n:
            c = src[i]
            if c.isspace():
                i += 1
            elif src.startswith('//', i):
                found = _LINE_END_RE.search(src, i)
                end = found.start() if found else n
                self._add('comment', i, src[i + 2:end], nested)
                i = end
            elif src.startswith('/*', i):
                close = src.find('*/', i + 2)
                self._add('comment', i, src[i + 2:n if close < 0 else close], nested)
                i = n if close < 0 else close + 2
            elif c in '"\'':
                value, end = self._quoted(i)
                self._add('str', i, value, nested)
                i = end
            elif c == '`':
                i = self._template(i, nested)
            elif nested:
                # Inside ${...} only strings matter; just find the closing brace.
                if c == '{':
                    depth += 1
                elif c == '}':
                    if depth == 0:
                        return i + 1
                    depth -= 1
                i += 1
            else:
                word = _WORD_RE.match(src, i)
                if word:
                    self._add('word', i, word.group(), nested)
                    i = word.end()
                else:
                    self._add('punct', i, c, nested)
                    i += 1
        return n

    def _quoted(self, i: int) -> tuple[str, int]:
        """Read the '...' or "..." string at i: (decoded value, end offset)."""
        src, n, quote = self.src, len(self.src), self.src[i]
        parts, j = [], i + 1
        while j < n:
            c = src[j]
            if c == '\\':
                decoded, j = read_escape(src, j)
                parts.append(decoded)
            elif c == quote:
                return join_surrogates(''.join(parts)), j + 1
            elif c in '\n\r':
                break  # unterminated: stop at the end of the line
            else:
                parts.append(c)
                j += 1
        return join_surrogates(''.join(parts)), j

    def _template(self, i: int, nested: bool) -> int:
        """Read the `...` template literal at i; its text parts become 'tpl' tokens."""
        src, n = self.src, len(self.src)
        parts: list[str] = []
        part_start, j = i, i + 1

        def flush() -> None:
            if parts:
                self._add('tpl', part_start, join_surrogates(''.join(parts)), nested)

        while j < n:
            c = src[j]
            if c == '\\':
                decoded, j = read_escape(src, j)
                parts.append(decoded)
            elif c == '`':
                flush()
                return j + 1
            elif src.startswith('${', j):
                flush()
                j = self._lex(j + 2, nested=True)
                parts, part_start = [], j
            else:
                parts.append(c)
                j += 1
        flush()
        return n


class ConfigKey(NamedTuple):
    name: str
    start: int  # where the key starts
    end: int    # where the next top-level key starts (or the object ends)


def _code_tokens(tokens: list[Token]) -> list[Token]:
    return [t for t in tokens if t.kind != 'comment' and not t.nested]


def _is_property_key(code: list[Token], i: int) -> bool:
    after = code[i + 1] if i + 1 < len(code) else None
    if after is None or after.kind != 'punct':
        return False
    if code[i].kind == 'str':
        return after.text == ':'
    return code[i].kind == 'word' and after.text in ':,}('


def find_top_level_keys(tokens: list[Token], src_len: int) -> tuple[list[ConfigKey], str]:
    """The keys directly inside each outermost {...} object: (keys, problem or '')."""
    code = _code_tokens(tokens)
    keys: list[ConfigKey] = []
    open_key: tuple[str, int] | None = None
    stack: list[str] = []
    expect_key = False
    for i, tok in enumerate(code):
        if tok.kind == 'punct' and tok.text in _CLOSERS:
            stack.append(tok.text)
            expect_key = tok.text == '{' and stack.count('{') == 1
            continue
        if tok.kind == 'punct' and tok.text in '}])':
            if not stack or _CLOSERS[stack.pop()] != tok.text:
                return keys, 'its brackets do not match'
            if tok.text == '}' and '{' not in stack and open_key:
                keys.append(ConfigKey(open_key[0], open_key[1], tok.start))
                open_key = None
            expect_key = False
            continue
        if not (stack and stack[-1] == '{' and stack.count('{') == 1):
            continue  # not directly inside the outermost object
        if tok.kind == 'punct' and tok.text == ',':
            expect_key = True
            continue
        if expect_key and _is_property_key(code, i):
            if open_key:
                keys.append(ConfigKey(open_key[0], open_key[1], tok.start))
            open_key = (tok.text, tok.start)
        expect_key = False
    if open_key:
        keys.append(ConfigKey(open_key[0], open_key[1], src_len))
    return keys, ('an object or array is never closed' if stack else '')


def leading_comments_start(tokens: list[Token], starts: list[int], src: str, key_start: int) -> int:
    """Where the comment lines directly above a key begin (key_start when there are none).

    A comment counts when it starts on a line of its own; a comment that follows
    code on the same line belongs to that code.
    """
    i = bisect.bisect_left(starts, key_start) - 1
    start = key_start
    while i >= 0 and tokens[i].kind == 'comment':
        pos = tokens[i].start
        line_start = max(src.rfind('\n', 0, pos), src.rfind('\r', 0, pos)) + 1
        if src[line_start:pos].strip():
            break
        start = pos
        i -= 1
    return start


def quoted_name_keys(tokens: list[Token]) -> set[int]:
    """Offsets of quoted property names that are plain identifiers ("fieldName": ...).

    These are structure, not content: the public project uses the same names.
    """
    code = _code_tokens(tokens)
    names = set()
    for i in range(1, len(code) - 1):
        tok, before, after = code[i], code[i - 1], code[i + 1]
        if (tok.kind == 'str' and _IDENT_RE.fullmatch(tok.text)
                and before.kind == 'punct' and before.text in '{,'
                and after.kind == 'punct' and after.text == ':'):
            names.add(tok.start)
    return names


def strings_in_comment(body: str) -> list[str]:
    found = []
    for match in _COMMENT_STRING_RE.finditer(body):
        value = decode_escapes(match.group(2))
        if _IDENT_RE.fullmatch(value) and body[match.end():].lstrip().startswith(':'):
            continue  # a quoted property name in commented-out code
        found.append(value)
    return found


def strings_in_span(tokens: list[Token], start: int, end: int, skip: set[int]) -> list[str]:
    """Every string literal that starts inside [start, end), including those in comments."""
    found: list[str] = []
    for tok in tokens:
        if not start <= tok.start < end or tok.start in skip:
            continue
        if tok.kind in ('str', 'tpl'):
            found.append(tok.text)
        elif tok.kind == 'comment':
            found.extend(strings_in_comment(tok.text))
    return found


def is_specific(value: str) -> bool:
    """True for strings specific enough to search for (see the top of this file)."""
    value = value.strip()
    if not value or _COLOUR_RE.fullmatch(value):
        return False
    if all(ch.isspace() or ch in string.punctuation or unicodedata.category(ch) in _FILLER_CATEGORIES
           for ch in value):
        return False
    letters = sum(1 for ch in value if ch.isalpha())
    return letters >= 3 or any(ord(ch) > 127 for ch in value)


def specific_strings(values: list[str]) -> list[str]:
    """Split on line breaks (the search is line by line), trim, keep specific ones, de-duplicate."""
    kept: dict[str, str] = {}
    for value in values:
        for piece in _SPLIT_LINES_RE.split(value):
            piece = piece.strip()
            if is_specific(piece):
                kept.setdefault(fold(piece), piece)
    return list(kept.values())


def harvest_config(src: str, fields: list[str] | None) -> tuple[list[str], list[str]]:
    """The specific strings of the chosen top-level keys (all keys when fields is None).

    Each key's part of the file runs from the key to the next top-level key. The
    comment lines directly above the key are added to it, because they usually
    describe that key. Returns (strings, warnings).
    """
    tokens = JsLexer(src).tokenize()
    keys, problem = find_top_level_keys(tokens, len(src))
    notes: list[str] = []
    if problem or not keys:
        notes.append(f'config.js: {problem or "no top-level keys found"}; '
                     'every string in the file is treated as private instead.')
        chosen: list[ConfigKey] = [ConfigKey('', 0, len(src))]
    elif fields is None:
        chosen = keys
    else:
        names = {key.name for key in keys}
        missing = [name for name in fields if name not in names]
        if missing:
            notes.append('config.js has no top-level key named: ' + ', '.join(missing)
                         + ' (check --fields or the @fields line; key names are case-sensitive).')
        chosen = [key for key in keys if key.name in fields]
    starts = [tok.start for tok in tokens]
    spans = [(leading_comments_start(tokens, starts, src, key.start), key.end) for key in chosen]
    skip = quoted_name_keys(tokens)
    values: list[str] = []
    for start, end in spans:
        values.extend(strings_in_span(tokens, start, end, skip))
    return specific_strings(values), notes


# ---------------------------------------------------------------------------
# Collecting the terms
# ---------------------------------------------------------------------------

_TITLE_RE = re.compile(r'<title\b[^>]*>(.*?)</title\s*>', re.IGNORECASE | re.DOTALL)


def html_titles(path: Path) -> list[str]:
    """The <title> text with entities decoded; also as written, when that differs.

    Runs of spaces are joined into one, as a browser shows the title, and the
    exact text is kept too when it is on one line.
    """
    found = _TITLE_RE.search(read_text_file(path))
    if not found:
        return []
    raw = found.group(1).strip()
    titles = [' '.join(html.unescape(raw).split()), ' '.join(raw.split())]
    if '\n' not in raw and '\r' not in raw:
        titles += [html.unescape(raw), raw]
    return [title for title in dict.fromkeys(titles) if title]


def find_config(private_dir: Path) -> Path | None:
    exact = private_dir / CONFIG_NAME
    if exact.is_file():
        return exact
    for entry in private_dir.iterdir():
        if entry.name.lower() == CONFIG_NAME and entry.is_file():
            return entry
    return None


def collect_private_terms(private_dir: Path, fields: list[str] | None, terms_file: TermsFile,
                          warnings: list[str]) -> list[tuple[str, str]]:
    """Read the private folder (never written to). Returns (term, source) pairs."""
    found: list[tuple[str, str]] = []
    names = {os.path.basename(os.path.abspath(private_dir)), private_dir.resolve().name}
    found += [(name, 'folder name') for name in sorted(names) if name.strip()]
    try:
        pages = sorted(p for p in private_dir.iterdir()
                       if p.suffix.lower() in ('.html', '.htm') and p.is_file())
        for page in pages:
            found.append((page.stem, 'page names and titles'))
            found += [(title, 'page names and titles') for title in html_titles(page)]
        config = find_config(private_dir)
        src = read_text_file(config) if config else None
    except OSError as exc:
        raise UsageError(f'cannot read the private folder: {exc}') from exc
    if src is None:
        warnings.append('No config.js in the private folder: no strings harvested from it.')
    else:
        strings, notes = harvest_config(src, fields)
        warnings.extend(notes)
        found += [(value, 'config.js') for value in strings]
    found += [(term, 'terms file') for term in terms_file.private]
    return found


@dataclass
class TermSet:
    private: list[Term]
    review: list[Term]
    private_by_source: dict[str, int]
    allowed: int        # private terms moved to review by @allow
    unused_allows: int  # @allow lines that matched no private term


def build_terms(found: list[tuple[str, str]], terms_file: TermsFile) -> TermSet:
    allow = {fold(text) for text in terms_file.allow}
    private: dict[str, Term] = {}
    review: dict[str, Term] = {}
    by_source: dict[str, int] = {}
    used_allows: set[str] = set()
    for text, source in found:
        term = make_term(text.strip(), True)
        if not term.key.strip():
            continue
        if term.key in allow:
            used_allows.add(term.key)
            review.setdefault(term.key, term._replace(private=False))
        elif term.key not in private:
            private[term.key] = term
            by_source[source] = by_source.get(source, 0) + 1
    for text in terms_file.review:
        term = make_term(text, False)
        if term.key.strip() and term.key not in private:
            review.setdefault(term.key, term)
    return TermSet(list(private.values()), list(review.values()), by_source,
                   len(used_allows), len(allow - used_allows))


# ---------------------------------------------------------------------------
# Running git
# ---------------------------------------------------------------------------

_GIT_REPO_VARIABLES = ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE',
                       'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES')
GIT_DIFF_OPTIONS = ('-p', '--no-color', '--no-ext-diff', '--no-textconv',
                    '--src-prefix=a/', '--dst-prefix=b/')


def git_env(keep_index: bool) -> dict[str, str]:
    """The environment without variables that would point git at another repository.

    GIT_INDEX_FILE is kept for the project's own repository: inside a git hook it
    names the index that is about to be committed.
    """
    env = dict(os.environ)
    for name in _GIT_REPO_VARIABLES + (() if keep_index else ('GIT_INDEX_FILE',)):
        env.pop(name, None)
    env['GIT_OPTIONAL_LOCKS'] = '0'  # read only: do not even refresh the index
    return env


def git_error(stderr: bytes, returncode: int) -> str:
    """The most useful line of git's error output."""
    lines = [ln.strip() for ln in stderr.decode('utf-8', 'replace').splitlines() if ln.strip()]
    for line in lines:
        if line.startswith(('fatal:', 'error:')):
            return line
    return lines[-1] if lines else f'exit code {returncode}'


def git_cmd(git: str, project: Path, *args: str) -> list[str]:
    """A git command for the project's own repository, with output settings fixed."""
    return [git, '-c', 'core.quotePath=false', '-c', 'log.showRoot=true',
            '-c', 'log.showSignature=false', '-C', str(project), *args]


def run_git(cmd: list[str], cwd: Path, keep_index: bool = True) -> bytes:
    try:
        proc = subprocess.run(cmd, cwd=str(cwd), env=git_env(keep_index), stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, stdin=subprocess.DEVNULL)
    except OSError as exc:
        raise GitError(str(exc)) from exc
    if proc.returncode != 0:
        raise GitError(git_error(proc.stderr, proc.returncode))
    return proc.stdout


# ---------------------------------------------------------------------------
# Which files would git commit?
# ---------------------------------------------------------------------------

def same_path(a: str, b: str) -> bool:
    return a.casefold() == b.casefold() if CASE_INSENSITIVE_FS else a == b


def relative_to_project(path: Path, project: Path) -> str | None:
    """The path relative to the project with '/' separators, or None when outside it."""
    try:
        rel = os.path.relpath(os.path.realpath(path), project)
    except ValueError:  # on another drive (Windows)
        return None
    rel = rel.replace(os.sep, '/')
    if rel in ('.', '..') or rel.startswith('../'):
        return None
    return rel


def _split_z(output: bytes) -> list[str]:
    return list(dict.fromkeys(os.fsdecode(raw) for raw in output.split(b'\0') if raw))


def git_list_files(git: str, project: Path) -> list[str]:
    """Files of an existing repository: tracked ones, plus untracked ones that are not ignored."""
    return _split_z(run_git(git_cmd(git, project, 'ls-files', '-co', '--exclude-standard', '-z'),
                            project))


def git_list_files_without_repo(git: str, project: Path) -> list[str]:
    """Ask git what it would commit, using a throw-away git folder outside the project."""
    if relative_to_project(Path(tempfile.gettempdir()), project) is not None:
        raise GitError('the temporary folder is inside the project')
    tmp = Path(tempfile.mkdtemp(prefix='check-private-'))
    try:
        base = [git, f'--git-dir={tmp}', f'--work-tree={project}']
        run_git([*base, 'init', '-q'], project, keep_index=False)
        return _split_z(run_git([*base, 'ls-files', '-co', '--exclude-standard', '-z'],
                                project, keep_index=False))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class IgnoreRule(NamedTuple):
    base: str          # folder of the .gitignore, relative to the project ('' = root)
    regex: re.Pattern
    anchored: bool     # True: match the path below base; False: match the name only
    dir_only: bool
    negated: bool


def glob_to_regex(pattern: str) -> str:
    """Translate a .gitignore glob (*, ?, [...], **) into a regular expression."""
    out, i, n = [], 0, len(pattern)
    while i < n:
        c = pattern[i]
        if c == '*':
            j = i
            while j < n and pattern[j] == '*':
                j += 1
            whole_part = (i == 0 or pattern[i - 1] == '/') and (j == n or pattern[j] == '/')
            if j - i >= 2 and whole_part:
                if j < n:
                    out.append('(?:.*/)?')  # '**/': any number of folders
                    j += 1
                else:
                    out.append('.*')        # trailing '/**': everything inside
            else:
                out.append('[^/]*')
            i = j
            continue
        if c == '?':
            out.append('[^/]')
        elif c == '[':
            k = i + 1
            if k < n and pattern[k] in '!^':
                k += 1
            if k < n and pattern[k] == ']':
                k += 1
            close = pattern.find(']', k)
            if close < 0:
                out.append(re.escape(c))
            else:
                inner = pattern[i + 1:close].replace('\\', '\\\\').replace('[', '\\[')
                if inner[:1] in ('!', '^'):
                    inner = '^' + inner[1:]
                out.append(f'[{inner}]')
                i = close
        elif c == '\\' and i + 1 < n:
            out.append(re.escape(pattern[i + 1]))
            i += 1
        else:
            out.append(re.escape(c))
        i += 1
    return ''.join(out)


def parse_gitignore(text: str, base: str) -> tuple[list[IgnoreRule], bool]:
    """Returns (rules, whether any '!' negation pattern was seen)."""
    flags = re.IGNORECASE if CASE_INSENSITIVE_FS else 0
    rules, negation = [], False
    for line in text.splitlines():
        if not line or line.startswith('#'):
            continue
        while line.endswith(' ') and not line.endswith('\\ '):
            line = line[:-1]  # trailing spaces are ignored unless escaped
        negated = line.startswith('!')
        if negated:
            line, negation = line[1:], True
        elif line.startswith(('\\!', '\\#')):
            line = line[1:]
        dir_only = line.endswith('/')
        line = line.rstrip('/')
        if not line:
            continue
        anchored = '/' in line
        rules.append(IgnoreRule(base, re.compile(glob_to_regex(line.lstrip('/')), flags),
                                anchored, dir_only, negated))
    return rules, negation


def is_ignored(rel: str, is_dir: bool, rules: list[IgnoreRule]) -> bool:
    ignored = False
    for rule in rules:  # the last matching rule decides, as in git
        if rule.dir_only and not is_dir:
            continue
        if rule.base:
            if not rel.startswith(rule.base + '/'):
                continue
            below = rel[len(rule.base) + 1:]
        else:
            below = rel
        target = below if rule.anchored else below.rsplit('/', 1)[-1]
        if rule.regex.fullmatch(target):
            ignored = not rule.negated
    return ignored


def walk_project(project: Path) -> tuple[list[str], bool]:
    """List files by walking the tree with a small .gitignore matcher (when git is missing).

    Returns (relative paths, whether any '!' negation pattern was seen).
    """
    files: list[str] = []
    negation_seen = False

    def load(path: Path, base: str) -> list[IgnoreRule]:
        nonlocal negation_seen
        try:
            text = path.read_text(encoding='utf-8', errors='replace')
        except OSError:
            return []
        rules, negation = parse_gitignore(text, base)
        negation_seen |= negation
        return rules

    def visit(folder: Path, rel_dir: str, inherited: list[IgnoreRule]) -> None:
        rules = inherited + load(folder / '.gitignore', rel_dir)
        try:
            with os.scandir(folder) as listing:
                entries = sorted(listing, key=lambda e: e.name)
        except OSError:
            return
        for entry in entries:
            if entry.name == '.git':
                continue
            rel = f'{rel_dir}/{entry.name}' if rel_dir else entry.name
            is_dir = entry.is_dir(follow_symlinks=False)
            if is_ignored(rel, is_dir, rules):
                continue
            if is_dir:
                visit(Path(entry.path), rel, rules)
            else:
                files.append(rel)

    visit(project, '', load(project / '.git' / 'info' / 'exclude', ''))
    return files, negation_seen


def list_project_files(project: Path, git: str | None, warnings: list[str]) -> tuple[list[str], str]:
    """Every file git would commit: (relative paths with '/', how they were listed)."""
    if (project / '.git').exists():
        if git:
            try:
                return git_list_files(git, project), 'git ls-files (the project repository)'
            except GitError as exc:
                warnings.append(f'git ls-files failed ({exc}); using the built-in .gitignore matcher.')
        else:
            warnings.append('git is not installed: using the built-in .gitignore matcher.')
    elif git:
        try:
            files = git_list_files_without_repo(git, project)
            return files, 'git ls-files with a temporary git folder outside the project'
        except GitError as exc:
            warnings.append(f'git could not list the files ({exc}); '
                            'using the built-in .gitignore matcher.')
    files, negation_seen = walk_project(project)
    warnings.append('The built-in .gitignore matcher only approximates git; '
                    'install git for an exact file list.')
    if negation_seen:
        warnings.append("'!' (negation) patterns in .gitignore are not fully supported by the "
                        'built-in matcher: check the file list by hand, or install git.')
    return files, 'built-in .gitignore matcher'


# ---------------------------------------------------------------------------
# Searching the files
# ---------------------------------------------------------------------------

def read_text(path: Path) -> str | None:
    """The file as text, or None when it is binary (by extension or by content)."""
    if path.suffix.lower().lstrip('.') in BINARY_EXTENSIONS:
        return None
    with open(path, 'rb') as fh:
        head = fh.read(SNIFF_BYTES)
        # UTF-16 text (e.g. written by Windows PowerShell) is text despite its NUL bytes.
        is_utf16 = head.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE))
        encoding = 'utf-16' if is_utf16 else 'utf-8-sig'
        try:  # incremental: a character cut in two at the 8 KB mark is fine
            sample = codecs.getincrementaldecoder(encoding)().decode(head, final=False)
        except UnicodeDecodeError:
            return None
        if '\0' in sample:
            return None
        data = head + fh.read()
    return data.decode(encoding, errors='replace')


def long_enough_for_binary(term: Term) -> bool:
    """Only terms of 6 or more bytes are looked for in binary data.

    Shorter ones (a single emoji is 4 bytes) turn up in compressed data by chance.
    """
    return len(term.key.encode('utf-8')) >= 6


def find_in_binary(path: Path, rel: str, terms: list[Term]) -> list[Hit]:
    """Terms in the raw bytes of a binary file, read as UTF-8.

    This finds text stored uncompressed inside binary files (image metadata, file
    names inside a zip, strings in compiled Python files). Compressed content
    stays invisible, so binary files are still listed to check by eye.
    """
    if path.stat().st_size > RAW_SEARCH_LIMIT:
        return []
    folded = fold(path.read_bytes().decode('utf-8', errors='replace'))
    found = [term for term in terms if long_enough_for_binary(term) and term.key in folded]
    return [Hit(rel, None, term, '(in the raw bytes of this binary file)') for term in unique_terms(found)]


@dataclass
class ScanResult:
    hits: list[Hit] = field(default_factory=list)
    text_files: int = 0
    binary_files: list[str] = field(default_factory=list)
    not_searched: list[tuple[str, str]] = field(default_factory=list)  # (path, reason)


def scan_files(project: Path, files: list[str], terms: list[Term]) -> ScanResult:
    result = ScanResult()
    for rel in files:
        result.hits += [Hit(rel, None, term, '(in the file path)') for term in find_in_path(rel, terms)]
        path = project.joinpath(*rel.split('/'))
        try:
            if path.is_symlink():
                text = os.readlink(path)  # git stores where the link points, not the file
            elif path.is_dir():
                result.not_searched.append((rel, 'a folder: nested repository or submodule'))
                continue
            elif not path.exists():
                result.not_searched.append((rel, 'listed by git but missing on disk'))
                continue
            else:
                text = read_text(path)
                if text is None:
                    result.binary_files.append(rel)
                    result.hits += find_in_binary(path, rel, terms)
                    continue
        except OSError as exc:
            result.not_searched.append((rel, f'could not be read: {exc.strerror or exc}'))
            continue
        result.text_files += 1
        result.hits += [Hit(rel, number, term, snippet)
                        for number, term, snippet in find_in_text(text, terms)]
    return result


# ---------------------------------------------------------------------------
# Searching git: history, staged changes, commit messages, branch names
# ---------------------------------------------------------------------------

# '@@ -1,3 +1,4 @@' for a normal diff; '@@@ -1,3 -1,3 +1,4 @@@' for a merge (one range per parent).
_HUNK_RE = re.compile(r'@@+ ((?:-\d+(?:,\d+)? )+)\+(\d+)(?:,(\d+))? @@')
_RANGE_RE = re.compile(r'-(\d+)(?:,(\d+))?')
_C_ESCAPES = {'a': 7, 'b': 8, 't': 9, 'n': 10, 'v': 11, 'f': 12, 'r': 13, '"': 34, '\\': 92}
TERMS_FILE_TERM = make_term('the terms file', True)


def git_unquote(text: str) -> str:
    """Undo git's C-style quoting of unusual file names ("a\\tb")."""
    if len(text) < 2 or text[0] != '"' or text[-1] != '"':
        return text
    body, out, i = text[1:-1], bytearray(), 0
    while i < len(body):
        if body[i] == '\\' and i + 1 < len(body):
            octal = body[i + 1:i + 4]
            if len(octal) == 3 and all(ch in '01234567' for ch in octal):
                out.append(int(octal, 8) & 0xFF)
                i += 4
                continue
            nxt = body[i + 1]
            out.extend(bytes([_C_ESCAPES[nxt]]) if nxt in _C_ESCAPES else nxt.encode('utf-8'))
            i += 2
        else:
            out.extend(body[i].encode('utf-8'))
            i += 1
    return out.decode('utf-8', errors='replace')


def _strip_side(path: str) -> str | None:
    path = git_unquote(path.rstrip('\t'))
    if path == '/dev/null':
        return None
    return path[2:] if path.startswith(('a/', 'b/')) else path


def split_diff_git(rest: str) -> tuple[str | None, str | None]:
    """The two paths of a 'diff --git a/X b/Y' line (rest is 'a/X b/Y')."""
    if rest.startswith('"'):
        j = 1
        while j < len(rest) and rest[j] != '"':
            j += 2 if rest[j] == '\\' else 1
        return _strip_side(rest[:j + 1]), _strip_side(rest[j + 1:].strip())
    if rest.endswith('"') and ' "' in rest:
        k = rest.rfind(' "')
        return _strip_side(rest[:k]), _strip_side(rest[k + 1:])
    same = rest[2:2 + (len(rest) - 5) // 2]  # 'a/' + P + ' b/' + P
    if rest == f'a/{same} b/{same}':
        return same, same
    middle = rest.find(' b/')
    if rest.startswith('a/') and middle > 0:  # a rename: 'rename from/to' lines follow
        return rest[2:middle], rest[middle + 3:]
    return None, None


class DiffScanner:
    """Searches 'git log -p' or 'git diff' output line by line: changed lines and file names.

    Merge commits come as combined diffs (--cc), with one +/- column per parent:
    only lines that are new in the merge itself are searched there, because the
    parents' own changes are searched in the parents' commits.
    """

    def __init__(self, terms: list[Term], terms_rel: str | None, origin: str = '',
                 staged: bool = False):
        self.terms = terms
        self.terms_rel = terms_rel
        self.origin = origin  # 'commit abc1234' (updated as commits go by) or 'staged'
        self.staged = staged  # staged changes: only added lines matter, names are checked elsewhere
        self.hits: list[Hit] = []
        self.binary: dict[str, str] = {}  # path -> where it was seen
        self.commits = 0
        self.old_path: str | None = None
        self.new_path: str | None = None
        self.skip_content = False
        self.parent_left: list[int] = []  # lines still to come in this hunk, per parent
        self.parent_no: list[int] = []    # current line number, per parent
        self.new_left = self.new_no = 0
        self._named: set[tuple[str, str]] = set()

    def in_hunk(self) -> bool:
        return self.new_left > 0 or any(left > 0 for left in self.parent_left)

    def feed(self, line: str) -> None:
        line = line.rstrip('\n')
        if line.endswith('\r'):
            line = line[:-1]
        if self.in_hunk():
            self._hunk_line(line)
        elif line.startswith('commit:'):
            self.origin = 'commit ' + line[len('commit:'):].strip()[:7]
            self.commits += 1
            self._start_file(None, None)
        elif line.startswith('diff --git '):
            self._start_file(*split_diff_git(line[len('diff --git '):]))
        elif line.startswith(('diff --cc ', 'diff --combined ')):
            path = git_unquote(line.split(' ', 2)[2])
            self._start_file(path, path)
        elif line.startswith(('rename from ', 'copy from ')):
            self.old_path = self._saw_path(git_unquote(line.split(' ', 2)[2]))
        elif line.startswith(('rename to ', 'copy to ')):
            self.new_path = self._saw_path(git_unquote(line.split(' ', 2)[2]))
        elif line.startswith('--- '):
            self.old_path = self._saw_path(_strip_side(line[4:])) or self.old_path
        elif line.startswith('+++ '):
            self.new_path = self._saw_path(_strip_side(line[4:])) or self.new_path
        elif line.startswith('Binary files '):
            path = self.new_path or self.old_path
            if path and not self.skip_content and not self.staged:
                self.binary.setdefault(path, self.origin)
        else:
            hunk = _HUNK_RE.match(line)
            if hunk:
                ranges = _RANGE_RE.findall(hunk.group(1))
                self.parent_no = [int(start) for start, _ in ranges]
                self.parent_left = [int(count) if count else 1 for _, count in ranges]
                self.new_no = int(hunk.group(2))
                self.new_left = int(hunk.group(3)) if hunk.group(3) else 1

    def _start_file(self, old: str | None, new: str | None) -> None:
        self.skip_content = False
        self.parent_left, self.new_left = [], 0
        self.old_path = self._saw_path(old)
        self.new_path = self._saw_path(new)

    def _saw_path(self, path: str | None) -> str | None:
        """Search a file name once per commit. The terms file's own lines are never searched."""
        if not path:
            return path
        is_terms_file = bool(self.terms_rel) and same_path(path, self.terms_rel)
        if is_terms_file:
            self.skip_content = True
        if not self.staged and (self.origin, path) not in self._named:
            self._named.add((self.origin, path))
            if is_terms_file:
                self.hits.append(Hit(path, None, TERMS_FILE_TERM,
                                     'the terms file itself was committed', self.origin))
            self.hits += [Hit(path, None, term, '(in the file path)', self.origin)
                          for term in find_in_path(path, self.terms)]
        return path

    def _hunk_line(self, line: str) -> None:
        """One line of a hunk: a +/- / space column per parent, then the text."""
        if line.startswith('\\'):  # "\ No newline at end of file"
            return
        width = len(self.parent_left)
        columns, text = line[:width].ljust(width), line[width:]  # an empty line is context
        if '-' in columns:  # in a parent, not in the result
            if width == 1 and not self.staged:  # a merge's parents are searched on their own
                self._search(text, self.old_path, self.parent_no[0], '-')
            used = [i for i, column in enumerate(columns) if column == '-']
        else:  # in the result
            if columns == '+' * width:  # new in this commit (for a merge: new in the merge itself)
                self._search(text, self.new_path, self.new_no, '+')
            self.new_no += 1
            self.new_left = max(self.new_left - 1, 0)
            used = [i for i, column in enumerate(columns) if column == ' ']
        for i in used:
            self.parent_no[i] += 1
            self.parent_left[i] = max(self.parent_left[i] - 1, 0)

    def _search(self, text: str, path: str | None, number: int, sign: str) -> None:
        if self.skip_content:
            return
        folded = fold(text)
        found = [term for term in self.terms if term.key in folded]
        for term in unique_terms(found) if found else ():
            self.hits.append(Hit(path or '?', number, term, excerpt(text, term.key),
                                 self.origin, sign))


def stream_git(cmd: list[str], project: Path, scanner: DiffScanner) -> str:
    """Run git and feed its output to the scanner line by line. Returns an error or ''."""
    with tempfile.TemporaryFile() as errors:
        try:
            proc = subprocess.Popen(cmd, cwd=str(project), env=git_env(keep_index=True),
                                    stdout=subprocess.PIPE, stderr=errors, stdin=subprocess.DEVNULL)
        except OSError as exc:
            return f'could not run git: {exc}'
        with proc.stdout:
            for raw in proc.stdout:
                scanner.feed(raw.decode('utf-8', errors='replace'))
        if proc.wait() != 0:
            errors.seek(0)
            return git_error(errors.read(), proc.returncode)
    return ''


def scan_commit_messages(git: str, project: Path, terms: list[Term]) -> list[Hit]:
    out = run_git(git_cmd(git, project, 'log', '--all', '--no-color', '--format=%x00%H%x00%B'),
                  project).decode('utf-8', errors='replace')
    parts = out.split('\0')
    hits = []
    for i in range(1, len(parts) - 1, 2):
        origin = 'commit ' + parts[i].strip()[:7]
        hits += [Hit('(commit message)', number, term, snippet, origin)
                 for number, term, snippet in find_in_text(parts[i + 1], terms)]
    return hits


def scan_refs(git: str, project: Path, terms: list[Term]) -> list[Hit]:
    """Branch and tag names, and the messages of annotated tags."""
    out = run_git(git_cmd(git, project, 'for-each-ref',
                          '--format=%(refname)%00%(objecttype)%00%(contents)%00'), project)
    parts = out.decode('utf-8', errors='replace').split('\0')
    hits = []
    for i in range(0, len(parts) - 2, 3):
        ref, kind, contents = parts[i].lstrip('\n'), parts[i + 1], parts[i + 2]
        hits += [Hit(ref, None, term, '(in a branch or tag name)', 'ref')
                 for term in find_in_path(ref, terms)]
        if kind == 'tag':
            hits += [Hit('(tag message)', number, term, snippet, ref)
                     for number, term, snippet in find_in_text(contents, terms)]
    return hits


@dataclass
class GitHistory:
    commits: int = 0
    committed: list[Hit] = field(default_factory=list)  # history, commit messages, branch names
    staged: list[Hit] = field(default_factory=list)     # staged, and not the same as on disk
    binary: dict[str, str] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


def scan_git(git: str, project: Path, terms: list[Term], terms_rel: str | None,
             on_disk: list[Hit]) -> GitHistory:
    """Search everything already in the repository, and what is staged for the next commit."""
    result = GitHistory()
    try:
        has_refs = bool(run_git(git_cmd(git, project, 'for-each-ref', '--count=1'), project).strip())
    except GitError as exc:
        result.errors.append(f'History not checked: {exc}')
        has_refs = False
    if has_refs:
        log = DiffScanner(terms, terms_rel)
        error = stream_git(git_cmd(git, project, 'log', '--all', '--cc', *GIT_DIFF_OPTIONS,
                                   '--format=commit:%H'), project, log)
        if error:
            result.errors.append(f'History not fully checked: git log failed ({error}).')
        result.commits, result.committed, result.binary = log.commits, log.hits, log.binary
        for what, scan in (('commit messages', scan_commit_messages),
                           ('branch and tag names', scan_refs)):
            try:
                result.committed += scan(git, project, terms)
            except GitError as exc:
                result.errors.append(f'{what.capitalize()} not checked: {exc}')

    staged = DiffScanner(terms, terms_rel, origin='staged', staged=True)
    error = stream_git(git_cmd(git, project, 'diff', '--cached', *GIT_DIFF_OPTIONS), project, staged)
    if error:
        result.errors.append(f'Staged changes not checked: {error}')
    # Lines that are also in the file on disk are reported once, as files on disk.
    known = {(hit.path, hit.term.text, hit.excerpt) for hit in on_disk}
    result.staged = [hit for hit in staged.hits if (hit.path, hit.term.text, hit.excerpt) not in known]
    return result


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

STAGED_TITLE = 'Staged for the next commit, but not the same as the file on disk:'
HISTORY_TITLE = 'Already in git (removing it means rewriting history):'


def format_hit(hit: Hit) -> str:
    where = clean(hit.path) if hit.line is None else f'{clean(hit.path)}:{hit.line}'
    origin = f'{hit.origin}  ' if hit.origin else ''
    return f'{origin}{where}  [{clean(hit.term.text)}]  {hit.sign}{hit.excerpt}'


def _sort_key(hit: Hit) -> tuple:
    return (hit.path.casefold(), hit.line or 0, hit.term.key)


def heading(title: str) -> None:
    print()
    print(title)
    print('-' * min(len(title), 78))


def print_groups(groups: list[tuple[str, list[Hit]]]) -> None:
    for title, hits in groups:
        if not hits:
            continue
        if title:
            print(f'  {title}')
        indent = '    ' if title else '  '
        for hit in hits:
            print(indent + format_hit(hit))


def print_review_counts(current: list[Hit], history: list[Hit]) -> None:
    """--quiet: one line per review term with the number of its hits."""
    now: dict[str, int] = {}
    files: dict[str, set[str]] = {}
    past: dict[str, int] = {}
    for hit in current:
        now[hit.term.text] = now.get(hit.term.text, 0) + 1
        files.setdefault(hit.term.text, set()).add(hit.path)
    for hit in history:
        past[hit.term.text] = past.get(hit.term.text, 0) + 1
    order = sorted(set(now) | set(past), key=lambda t: (-now.get(t, 0) - past.get(t, 0), t.casefold()))
    for text in order:
        line = f'  [{clean(text)}]  {now.get(text, 0)} hit(s) in {len(files.get(text, ()))} file(s)'
        if past.get(text):
            line += f', {past[text]} in git history'
        print(line)


@dataclass
class Outcome:
    project: Path
    how_listed: str
    files: int
    scan: ScanResult
    terms: TermSet
    terms_note: str
    terms_listed: str | None  # relative path of a terms file that git would commit
    warnings: list[str]
    git: GitHistory | None
    history_note: str

    def split(self) -> tuple[list[list[Hit]], list[list[Hit]]]:
        """([on disk, staged, history] private hits, the same for review hits)."""
        groups = [sorted(self.scan.hits, key=_sort_key),
                  self.git.staged if self.git else [],
                  self.git.committed if self.git else []]
        return ([[h for h in g if h.term.private] for g in groups],
                [[h for h in g if not h.term.private] for g in groups])

    @property
    def failed(self) -> bool:
        return bool(any(self.split()[0]) or self.terms_listed)

    @property
    def incomplete(self) -> bool:
        """The repository exists but git could not show all of it."""
        return bool(self.git and self.git.errors)


def print_report(out: Outcome, quiet: bool) -> None:
    sources = ', '.join(f'{name} {count}' for name, count in out.terms.private_by_source.items())
    allowed = f' (incl. {out.terms.allowed} allowed by @allow)' if out.terms.allowed else ''
    print('=' * 78)
    print('Privacy check: is anything from the private project in this public one?')
    print('=' * 78)
    print(f'Project:        {out.project}')
    print(f'Files scanned:  {out.files}  (as text: {out.scan.text_files}, '
          f'binary: {len(out.scan.binary_files)}, not searched: {len(out.scan.not_searched)})')
    print(f'Listed by:      {out.how_listed}')
    print(f'Private terms:  {len(out.terms.private)}  ({sources or "none"})')
    print(f'Review terms:   {len(out.terms.review)}{allowed}')
    print(f'Terms file:     {out.terms_note}')

    if out.terms_listed:
        print()
        print('!' * 78)
        print(f'!!! WARNING: the terms file "{out.terms_listed}" would be committed to git.')
        print('!!! It holds private terms, and they would be published with it.')
        print(f'!!! Add this line to .gitignore:   /{out.terms_listed}')
        print(f'!!! If git already tracks it, also run:   git rm --cached "{out.terms_listed}"')
        print('!!! It was not searched, and this check fails until it is ignored.')
        print('!' * 78)
    if out.warnings:
        heading('Warnings')
        for warning in out.warnings:
            print(f'  - {warning}')

    private, review = out.split()
    titles = ['', STAGED_TITLE, HISTORY_TITLE]
    private_count, review_count = sum(map(len, private)), sum(map(len, review))
    if private_count:
        heading(f'PRIVATE CONTENT FOUND ({private_count})')
        print_groups(list(zip(titles, private)))
    else:
        heading('Private content')
        print('  No private content found.')

    heading(f'To review ({review_count})')
    if not review_count:
        print('  Nothing to review.')
    elif quiet:
        print_review_counts(review[0] + review[1], review[2])
    else:
        print_groups(list(zip(titles, review)))

    unseen = len(out.scan.binary_files) + len(out.scan.not_searched)
    heading(f'Check these by eye ({unseen}): text search cannot see inside them')
    if not unseen:
        print('  None.')
    for rel in out.scan.binary_files:
        print(f'  {clean(rel)}')
    for rel, reason in out.scan.not_searched:
        print(f'  {clean(rel)}  ({reason})')

    heading('Git history')
    if out.git is None:
        print(f'  {out.history_note}')
    else:
        print(f'  Searched {out.git.commits} commit(s), their messages, the branch and tag names, '
              f'and staged changes: {len(private[1]) + len(private[2])} private and '
              f'{len(review[1]) + len(review[2])} review hit(s), listed above.')
        if out.git.binary:
            print('  Binary files in the history (not searched; check by eye):')
            for path, origin in sorted(out.git.binary.items()):
                print(f'    {clean(path)}  ({origin})')

    print()
    print('=' * 78)
    if out.failed:
        print('RESULT: FAIL - private content would be published. Fix the items above first.')
    elif out.incomplete:
        print('RESULT: INCOMPLETE - git could not show everything (see Warnings), so the '
              'check cannot pass.')
    else:
        extra = f' {review_count} hit(s) to review.' if review_count else ''
        print(f'RESULT: PASS - no private content found.{extra}')
    print('=' * 78)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Check that nothing from the private project ends up in this public one.',
        epilog='The terms file format is described at the top of this script. Exit codes: '
               '0 = clean, 1 = private content found, 2 = usage or configuration error.')
    parser.add_argument('--private-dir', required=True, metavar='PATH',
                        help="the private project's folder (only read, never changed)")
    parser.add_argument('--project', metavar='DIR',
                        help='the public project folder (default: the folder above this script)')
    parser.add_argument('--terms', metavar='FILE',
                        help=f'the terms file (default: <project>/{DEFAULT_TERMS_NAME}, optional)')
    parser.add_argument('--fields', metavar='a,b,c',
                        help='top-level keys of the private config.js to harvest '
                             '(overrides @fields in the terms file; default: all keys)')
    parser.add_argument('--quiet', action='store_true',
                        help='show only counts per term in the "To review" section')
    return parser.parse_args(argv)


def configure_console() -> None:
    """Never crash on characters the terminal cannot show (e.g. emoji on older Windows consoles)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors='backslashreplace')
        except (AttributeError, ValueError):
            pass


def run(args: argparse.Namespace) -> int:
    private_dir = Path(args.private_dir)
    if not private_dir.is_dir():
        raise UsageError(f'--private-dir is not an existing folder: {args.private_dir}')
    project = Path(args.project).resolve() if args.project else Path(__file__).resolve().parent.parent
    if not project.is_dir():
        raise UsageError(f'--project is not an existing folder: {project}')
    if private_dir.resolve() == project:
        raise UsageError('--private-dir and --project are the same folder')

    terms_path = Path(args.terms) if args.terms else project / DEFAULT_TERMS_NAME
    if args.terms and not terms_path.is_file():
        raise UsageError(f'terms file not found: {args.terms}')
    terms_file = read_terms_file(terms_path) if terms_path.is_file() else TermsFile()
    warnings = list(terms_file.problems)

    fields = terms_file.fields
    if args.fields is not None:
        fields = split_fields(args.fields)
        if not fields:
            raise UsageError('--fields needs at least one key name')

    term_set = build_terms(collect_private_terms(private_dir, fields, terms_file, warnings), terms_file)
    if term_set.unused_allows:
        warnings.append(f'{term_set.unused_allows} @allow line(s) matched no private term.')

    git = shutil.which('git')
    files, how_listed = list_project_files(project, git, warnings)

    # Never search (or print) the terms file itself, but fail loudly if git would commit it.
    # Its path is known even when it is missing now, to notice it in the git history.
    terms_rel = relative_to_project(terms_path, project)
    terms_listed = None
    if terms_rel and terms_path.is_file():
        kept = [rel for rel in files if not same_path(rel, terms_rel)]
        if len(kept) != len(files):
            terms_listed, files = terms_rel, kept
    if not terms_path.is_file():
        terms_note = f'none ({DEFAULT_TERMS_NAME} not found; it is optional)'
    elif terms_rel is None:
        terms_note = 'the file given with --terms (outside the project)'
    else:
        terms_note = f'{terms_rel} ({"NOT ignored: see the warning below" if terms_listed else "ignored: good"})'

    all_terms = search_terms(term_set.private + term_set.review)
    scan = scan_files(project, files, all_terms)

    history, history_note = None, ''
    if not (project / '.git').exists():
        history_note = 'No git repository yet: history not checked.'
    elif not git:
        history_note = 'git is not installed: history not checked.'
        warnings.append(history_note)
    else:
        history = scan_git(git, project, all_terms, terms_rel, scan.hits)
        warnings += history.errors

    outcome = Outcome(project, how_listed, len(files), scan, term_set, terms_note, terms_listed,
                      warnings, history, history_note)
    print_report(outcome, args.quiet)
    if outcome.failed:
        return EXIT_PRIVATE
    return EXIT_USAGE if outcome.incomplete else EXIT_OK


def main(argv: list[str] | None = None) -> int:
    configure_console()
    args = parse_args(argv)
    try:
        return run(args)
    except UsageError as exc:
        print(f'error: {exc}', file=sys.stderr)
        return EXIT_USAGE
    except Exception:  # never let a crash look like a clean result
        traceback.print_exc()
        print('error: the check could not finish (see above); nothing was verified.', file=sys.stderr)
        return EXIT_USAGE


if __name__ == '__main__':
    sys.exit(main())
