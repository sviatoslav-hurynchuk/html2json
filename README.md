# html2json — Pure JavaScript HTML-to-JSON Converter

A zero-dependency, crash-proof HTML parser that converts any HTML string into a JSON AST (Abstract Syntax Tree). Built entirely in pure JavaScript — no `DOMParser`, no browser DOM APIs, no third-party libraries.

## Quick Start

### Visual testing (browser)

Open `index.html` in any browser. Paste HTML into the left textarea and click **Convert to JSON**. Two built-in examples are available via the buttons.

### Automated tests (Node.js)

```bash
node test_html2json.js
```

Runs 66 assertions covering input validation, all 10 sample files, structural correctness, and crash resilience. Exit code `0` = all passed.

---

## AST Schema Design

The parser produces a tree of nodes. Every node carries a discriminated `type` field so consumers can process the tree with a simple `switch (node.type)` — no guessing, no `instanceof`, no duck-typing.

### Why this schema?

Three approaches were evaluated:

| Criterion | htmlparser2-style (flat) | parse5-style (W3C DOM) | **Chosen (hybrid)** |
|---|:---:|:---:|:---:|
| Readability | ⭐⭐⭐ | ⭐ | ⭐⭐⭐ |
| Node order preservation | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Attribute ergonomics | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |
| Doctype / comment support | ❌ | ⭐⭐⭐ | ⭐⭐⭐ |
| JSON-serialisable (no circular refs) | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ |

**Key decisions:**

- **`type` discriminator** — instant identification of any node without inspecting its shape.
- **`attributes` as a flat `{}` object** — covers 99.9% of real-world HTML and enables `node.attributes.href` access instead of array-scanning. Trade-off: duplicate attribute names collapse (last-wins), which matches browser behaviour anyway.
- **`children` as an ordered `[]` array** — preserves exact sibling order of elements, text, and comments, which is critical for faithful HTML representation.
- **`document` root** — always wraps the output so that fragments with multiple top-level nodes (`<p>A</p><p>B</p>`) produce a valid single-root tree.

### Node types

```
document  → { type: "document", children: [...] }
element   → { type: "element",  tag, attributes, children, selfClosing? }
text      → { type: "text",     content }
comment   → { type: "comment",  content }
doctype   → { type: "doctype",  content }
cdata     → { type: "cdata",    content }
```

### Example

```html
<!DOCTYPE html>
<html lang="en">
  <body>
    <!-- greeting -->
    <h1 class="title">Hello</h1>
    <br/>
  </body>
</html>
```

```json
{
  "type": "document",
  "children": [
    { "type": "doctype", "content": "html" },
    {
      "type": "element", "tag": "html", "attributes": { "lang": "en" },
      "children": [
        {
          "type": "element", "tag": "body", "attributes": {},
          "children": [
            { "type": "comment", "content": " greeting " },
            {
              "type": "element", "tag": "h1",
              "attributes": { "class": "title" },
              "children": [{ "type": "text", "content": "Hello" }]
            },
            {
              "type": "element", "tag": "br", "attributes": {},
              "children": [], "selfClosing": true
            }
          ]
        }
      ]
    }
  ]
}
```

---

## No-Crash Architecture

The code **MUST NOT crash** on any input. This is achieved through four layers of defence:

### Layer 1 — Input validation

`null`, `undefined`, numbers, objects, arrays — anything that isn't a string returns `{ type: "document", children: [] }` immediately.

### Layer 2 — Graceful handling of broken HTML

| Scenario | Strategy |
|---|---|
| Unclosed tags (`<div><p>text`) | Remain on the stack; the tree is structurally valid (just not closed) |
| Stray closing tags (`</span>` without an opener) | `closeTag()` scans the stack, finds no match, silently ignores |
| Mismatched nesting (`<b><i>…</b></i>`) | Closing `</b>` pops both `<i>` and `<b>` — implicit auto-close |
| `<` not followed by a letter (`3 < 5`) | Emitted as literal text, not treated as a tag |
| Incomplete tag at EOF (`<div class="oops`) | Attribute parser runs to end-of-string, returns what it could parse |
| Unknown `<!…>` declarations | Skipped to the next `>` |
| Unterminated comments (`<!-- no end`) | Content consumed to EOF |

### Layer 3 — Iterative algorithms

`filterWhitespace()` uses an explicit stack (`queue.pop()`) instead of recursion, preventing call-stack overflow on adversarially deep nesting (tested with 200+ levels).

### Layer 4 — Top-level `try/catch`

The entire `html2json()` body is wrapped in a `try/catch`. If any unforeseen error escapes layers 1–3, the catch returns a valid empty document instead of throwing.

---

## Feature Overview

| Feature | Details |
|---|---|
| Void elements | All 14 HTML5 void tags + explicit `<tag/>` syntax |
| Raw-text elements | `<script>`, `<style>`, `<textarea>` — inner content not parsed as HTML |
| Attributes | Double-quoted, single-quoted, unquoted, boolean (`disabled` → `true`) |
| Tag normalisation | All tag and attribute names lowercased |
| Whitespace filtering | Text nodes consisting entirely of whitespace are removed |
| Comments | `<!-- … -->` preserved with content |
| Doctype | `<!DOCTYPE …>` captured |
| CDATA | `<![CDATA[ … ]]>` captured |
| Processing instructions | `<?xml …?>` silently skipped |
| Custom elements | `<my-widget>` (hyphenated names supported) |
| XML namespaces | `<svg:rect>` (colon-separated names supported) |

---

## Test Samples

The `html_samples/` directory contains 10 files, each targeting a specific category:

| File | What it tests |
|---|---|
| `01_full_page.html` | Complete HTML5 page: head, body, nav, sections, footer, inline script |
| `02_void_elements.html` | All 14 void tags: `<br>`, `<br/>`, `<br />`, `<img>`, `<input>`, etc. |
| `03_attributes.html` | Quoting styles, boolean attrs, URLs with `?`, `&`, `#`, empty values |
| `04_comments_doctype.html` | Single-line, multi-line, and empty comments; doctype variations |
| `05_broken_html.html` | Unclosed tags, stray closers, mismatched nesting, non-tag `<`, incomplete tags |
| `06_script_style.html` | JS/CSS with `<`, `>`, template literals inside script/style; textarea raw text |
| `07_mixed_content.html` | Inline text interleaved with elements; HTML entities; plain text without tags |
| `08_tables_lists.html` | Tables (thead/tbody/tfoot, rowspan/colspan), definition lists, nested lists |
| `09_svg_mathml_custom.html` | SVG, MathML, custom elements, namespaced attributes, CDATA, XML PI |
| `10_edge_cases.html` | Uppercase/mixed-case tags, fragments, rapid open/close, 20 siblings |

---

## Repository Structure

```
├── html2json.js           Main implementation
├── index.html             Browser UI (provided by Jito, unchanged)
├── test_html2json.js      Automated test suite (66 assertions)
├── html_samples/          10 HTML files for testing
│   ├── 01_full_page.html
│   ├── ...
│   └── 10_edge_cases.html
├── ai_help/               AI conversation artifacts
└── README.md              This file
```
