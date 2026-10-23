// ============================================================
//  html2json.js — Pure JavaScript HTML-to-JSON AST converter
//
//  Constraints:
//    • No DOMParser, no browser DOM APIs, no third-party libs
//    • MUST NOT crash on any input
// ============================================================

// -------------------- Constants ----------------------------

/**
 * HTML5 void elements — they never have children and don't need
 * a closing tag.  We also accept the `<tag />` syntax for them.
 */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Elements whose inner content must be consumed as raw text
 * until the matching closing tag — we never parse `<` or `>`
 * inside them as HTML markup.
 */
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea']);

// -------------------- Tree helpers -------------------------

/**
 * Append `node` as a child of the element currently on top of
 * the open-elements stack.
 */
function addChild(stack, node) {
  stack[stack.length - 1].children.push(node);
}

/**
 * Append a chunk of text to the current parent.
 * Consecutive calls are merged into a single `text` node so
 * the final tree stays compact.
 */
function addTextChild(stack, text) {
  if (!text) return;

  const parent   = stack[stack.length - 1];
  const lastChild = parent.children[parent.children.length - 1];

  if (lastChild && lastChild.type === 'text') {
    lastChild.content += text;
  } else {
    parent.children.push({ type: 'text', content: text });
  }
}

/**
 * Close an open element.
 *
 * The stack is searched **top-to-bottom** for a matching tag.
 *   • Found → pop everything from the match upward (handles
 *             the common "forgot to close an inner tag" case).
 *   • Not found → the stray `</tag>` is silently ignored so
 *             we never crash on broken HTML.
 *
 * Index 0 (the document root) is never popped.
 */
function closeTag(stack, tagName) {
  for (let i = stack.length - 1; i >= 1; i--) {
    if (stack[i].tag === tagName) {
      stack.length = i;          // pop [i … top]
      return;
    }
  }
  // no match → ignore the orphan closing tag
}

// -------------------- Attribute parser ---------------------

/**
 * Parse the attribute list that follows a tag name.
 *
 * Supported syntaxes:
 *   • double-quoted   —  class="card"
 *   • single-quoted   —  class='card'
 *   • unquoted        —  class=card
 *   • boolean         —  disabled        →  { disabled: true }
 *   • URLs w/ specials —  href="https://x.com/a?b=1&c=2"
 *
 * @param {string} html  Full HTML string
 * @param {number} pos   Index right after the tag name
 * @returns {{ attributes: Object, selfClosing: boolean, end: number }}
 */
function parseAttributes(html, pos) {
  const len        = html.length;
  const attributes = {};
  let   i          = pos;
  let   selfClosing = false;

  while (i < len) {
    // skip whitespace
    while (i < len && /\s/.test(html[i])) i++;
    if (i >= len) break;

    // end of opening tag
    if (html[i] === '>') { i++; break; }
    if (html[i] === '/' && i + 1 < len && html[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }

    // ---- attribute name ----
    const nameStart = i;
    while (i < len && !/[\s=\/>]/.test(html[i])) i++;
    const attrName = html.slice(nameStart, i).toLowerCase();

    if (!attrName) { i++; continue; }   // skip stray characters

    // skip whitespace before a possible `=`
    while (i < len && /\s/.test(html[i])) i++;

    if (i < len && html[i] === '=') {
      // ---- attribute with value ----
      i++;                                        // skip '='
      while (i < len && /\s/.test(html[i])) i++;  // skip ws after '='

      let value = '';

      if (i < len && (html[i] === '"' || html[i] === "'")) {
        // quoted value
        const quote    = html[i++];
        const valStart = i;
        while (i < len && html[i] !== quote) i++;
        value = html.slice(valStart, i);
        if (i < len) i++;                          // skip closing quote
      } else {
        // unquoted value — ends at whitespace or `>`
        const valStart = i;
        while (i < len && !/[\s>]/.test(html[i])) i++;
        value = html.slice(valStart, i);
      }

      attributes[attrName] = value;
    } else {
      // boolean attribute (no `=`)
      attributes[attrName] = true;
    }
  }

  return { attributes, selfClosing, end: i };
}

// -------------------- Whitespace filter --------------------

/**
 * Remove text nodes that consist **entirely** of whitespace /
 * newlines (inter-element formatting).  Text that contains at
 * least one visible character is kept untouched.
 *
 * Uses an iterative stack to avoid call-stack overflow on
 * deeply nested documents.
 */
function filterWhitespace(root) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.pop();
    if (!node.children) continue;

    node.children = node.children.filter(function (child) {
      if (child.type === 'text' && /^\s+$/.test(child.content)) {
        return false;   // drop whitespace-only node
      }
      return true;
    });

    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].children) {
        queue.push(node.children[i]);
      }
    }
  }
}

// -------------------- Main parser --------------------------

/**
 * Convert an HTML string into a JSON AST.
 *
 * === Node types ===
 *
 *  Document : { type:"document", children:[] }
 *  Element  : { type:"element",  tag, attributes, children, selfClosing? }
 *  Text     : { type:"text",     content }
 *  Comment  : { type:"comment",  content }
 *  Doctype  : { type:"doctype",  content }
 *  CDATA    : { type:"cdata",    content }
 *
 * @param  {string} htmlText  Raw HTML string
 * @return {Object}           JSON AST
 */
function html2json(htmlText) {

  // ---- input validation (MUST NOT crash) ----
  if (htmlText == null || typeof htmlText !== 'string') {
    return { type: 'document', children: [] };
  }

  // Top-level try/catch — ultimate safety net
  try {
    const root  = { type: 'document', children: [] };
    const stack = [root];          // open-elements stack; root never pops
    let   pos   = 0;
    const len   = htmlText.length;

    while (pos < len) {

      // ============== Plain text ==============
      if (htmlText[pos] !== '<') {
        const nextLT = htmlText.indexOf('<', pos);
        const text   = nextLT === -1
          ? htmlText.slice(pos)
          : htmlText.slice(pos, nextLT);
        addTextChild(stack, text);
        pos = nextLT === -1 ? len : nextLT;
        continue;
      }

      // We are at `<` — determine what construct follows.

      // ============== Comment  <!-- … --> ==============
      if (htmlText.startsWith('<!--', pos)) {
        const endIdx = htmlText.indexOf('-->', pos + 4);
        addChild(stack, {
          type:    'comment',
          content: endIdx === -1
            ? htmlText.slice(pos + 4)
            : htmlText.slice(pos + 4, endIdx),
        });
        pos = endIdx === -1 ? len : endIdx + 3;
        continue;
      }

      // ============== Doctype  <!DOCTYPE …> ==============
      if (/^<!doctype[\s>]/i.test(htmlText.slice(pos, pos + 11))) {
        const endIdx = htmlText.indexOf('>', pos);
        const raw    = endIdx === -1
          ? htmlText.slice(pos + 10)
          : htmlText.slice(pos + 10, endIdx);
        addChild(stack, { type: 'doctype', content: raw.trim() });
        pos = endIdx === -1 ? len : endIdx + 1;
        continue;
      }

      // ============== CDATA  <![CDATA[ … ]]> ==============
      if (htmlText.startsWith('<![CDATA[', pos)) {
        const endIdx = htmlText.indexOf(']]>', pos + 9);
        addChild(stack, {
          type:    'cdata',
          content: endIdx === -1
            ? htmlText.slice(pos + 9)
            : htmlText.slice(pos + 9, endIdx),
        });
        pos = endIdx === -1 ? len : endIdx + 3;
        continue;
      }

      // ============== Unknown <! … > declaration ==============
      if (pos + 1 < len && htmlText[pos + 1] === '!') {
        const endIdx = htmlText.indexOf('>', pos);
        pos = endIdx === -1 ? len : endIdx + 1;
        continue;
      }

      // ============== Processing instruction <? … ?> ==============
      if (pos + 1 < len && htmlText[pos + 1] === '?') {
        const piEnd = htmlText.indexOf('?>', pos + 2);
        if (piEnd !== -1) {
          pos = piEnd + 2;
        } else {
          const gt = htmlText.indexOf('>', pos);
          pos = gt === -1 ? len : gt + 1;
        }
        continue;
      }

      // ============== Closing tag  </…> ==============
      if (pos + 1 < len && htmlText[pos + 1] === '/') {
        const endIdx = htmlText.indexOf('>', pos);
        if (endIdx === -1) {
          // malformed — treat rest of string as text
          addTextChild(stack, htmlText.slice(pos));
          pos = len;
        } else {
          const tagName = htmlText.slice(pos + 2, endIdx)
            .trim()
            .split(/[\s\/]/)[0]
            .toLowerCase();
          if (tagName) closeTag(stack, tagName);
          pos = endIdx + 1;
        }
        continue;
      }

      // ============== Opening tag  <tag …> ==============

      let i = pos + 1;

      // tag name must start with a letter; otherwise treat `<` as text
      if (i >= len || !/[a-zA-Z]/.test(htmlText[i])) {
        addTextChild(stack, '<');
        pos++;
        continue;
      }

      // read tag name (letters, digits, hyphens for custom elements,
      // colons for XML namespaces)
      const nameStart = i;
      while (i < len && /[a-zA-Z0-9\-:]/.test(htmlText[i])) i++;
      const tagName = htmlText.slice(nameStart, i).toLowerCase();

      // parse attributes + detect `/>` self-closing syntax
      const { attributes, selfClosing, end } = parseAttributes(htmlText, i);

      // build the node
      const node = {
        type:       'element',
        tag:        tagName,
        attributes: attributes,
        children:   [],
      };

      // ---- void / self-closing element ----
      if (selfClosing || VOID_TAGS.has(tagName)) {
        node.selfClosing = true;
        addChild(stack, node);
        pos = end;
        continue;
      }

      // ---- raw-text element (<script>, <style>, <textarea>) ----
      if (RAW_TEXT_TAGS.has(tagName)) {
        addChild(stack, node);

        // find the matching closing tag (case-insensitive)
        const closeRe   = new RegExp('<\\/' + tagName + '\\s*>', 'i');
        const remaining = htmlText.slice(end);
        const match     = closeRe.exec(remaining);

        if (!match) {
          // no closing tag → rest of the string is raw content
          const raw = htmlText.slice(end);
          if (raw) node.children.push({ type: 'text', content: raw });
          pos = len;
        } else {
          const raw = remaining.slice(0, match.index);
          if (raw) node.children.push({ type: 'text', content: raw });
          pos = end + match.index + match[0].length;
        }
        continue;
      }

      // ---- normal element ----
      addChild(stack, node);
      stack.push(node);           // push onto open-elements stack
      pos = end;
    }

    // ---- post-processing ----
    filterWhitespace(root);

    return root;

  } catch (_err) {
    // ultimate crash protection — return a valid empty document
    return { type: 'document', children: [] };
  }
}

// ============================================================
//  UI helpers (used by index.html — kept unchanged)
// ============================================================

function convertHtml2JsonAndSet() {
  const htmlTextAreaValue = document.getElementById("html").value;
  const jsonObj = html2json(htmlTextAreaValue);
  const jsonArea = document.getElementById("json");
  jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
}

function showExample1() {
  const htmlExample = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport">
    <title>Sample HTML</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <header>
        <h1>Welcome to My Website</h1>
    </header>
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    <main>
        <section id="home">
            <h2>Home Section</h2>
            <p>This is the home section of the webpage.</p>
        </section>
        <section id="about">
            <h2>About Section</h2>
            <p>This is the about section of the webpage.</p>
        </section>
    </main>
    <footer>
        <p>&copy; 2024 My Website</p>
    </footer>
    <script src="script.js"></script>
</body>
</html>
`;
  const jsonContent = {
    "Comment 1":
      "You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.",
    "Comment 2":
      "When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.",
  };

  document.getElementById("html").value = htmlExample;
  document.getElementById("json").textContent = JSON.stringify(
    jsonContent,
    null,
    2
  );
}

function showExample2() {
  const htmlExample = `<div>
<p>Hello world!</p>
  <button>Click me!</button>
  <textarea>Some very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very very long string.</textarea>
</div>
`;
  const jsonContent = {
    "Comment 1":
      "You have to think about how to take into account various html inputs so your json structure will cover them all and handle different cases.",
    "Comment 2":
      "When you make any choice in terms of selecting specific json structure for conversion - be ready to provide reasoning behind such choice.",
  };

  document.getElementById("html").value = htmlExample;
  document.getElementById("json").textContent = JSON.stringify(
    jsonContent,
    null,
    2
  );
}
