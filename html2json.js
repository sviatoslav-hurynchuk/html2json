// html2json.js — Pure JavaScript HTML-to-JSON AST converter

// Per HTML5 spec §12.1.2 — the complete list of void elements.
// These never enter the open-elements stack because they cannot have children.
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Per HTML5 spec §12.2.6.4 — raw text elements.
// Their content is consumed verbatim until the matching closing tag;
// any `<` or `>` inside is NOT treated as markup (e.g. JS operators in <script>).
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea']);

function addChild(stack, node) {
  stack[stack.length - 1].children.push(node);
}

// Merges consecutive text chunks into one node so that sequences like
// "3 < 5" (where `<` is rejected as a tag and re-emitted as text)
// produce a single coherent text node instead of fragmented pieces.
function addTextChild(stack, text) {
  if (!text) return;

  const parent    = stack[stack.length - 1];
  const lastChild = parent.children[parent.children.length - 1];

  if (lastChild && lastChild.type === 'text') {
    lastChild.content += text;
  } else {
    parent.children.push({ type: 'text', content: text });
  }
}

// Searches the stack top-to-bottom. If a match is found, everything
// above it is implicitly closed (handles `<b><i>…</b></i>` pattern).
// Using openCounts gives O(1) early exit when the tag is not open,
// preventing quadratic scan on unmatched closing tags.
// Index 0 (document root) is never popped — this is the invariant
// that guarantees we always have a valid parent to attach nodes to.
function closeTag(stack, openCounts, tagName) {
  if (!openCounts.get(tagName)) return;
  while (stack.length > 1) {
    const node = stack.pop();
    const count = openCounts.get(node.tag) - 1;
    if (count > 0) {
      openCounts.set(node.tag, count);
    } else {
      openCounts.delete(node.tag);
    }
    if (node.tag === tagName) return;
  }
}

/**
 * @param {string} html  Full HTML string
 * @param {number} pos   Index right after the tag name
 * @returns {{ attributes: Object, selfClosing: boolean, end: number }}
 */
function parseAttributes(html, pos) {
  const len        = html.length;
  // Use null-prototype object so attributes like __proto__, hasOwnProperty,
  // or toString become normal own properties without prototype pollution.
  const attributes = Object.create(null);
  let   i          = pos;
  let   selfClosing = false;

  while (i < len) {
    while (i < len && /\s/.test(html[i])) i++;
    if (i >= len) break;

    if (html[i] === '>') { i++; break; }
    if (html[i] === '/' && i + 1 < len && html[i + 1] === '>') {
      selfClosing = true;
      i += 2;
      break;
    }

    const nameStart = i;
    while (i < len && !/[\s=\/>]/.test(html[i])) i++;
    const attrName = html.slice(nameStart, i).toLowerCase();

    if (!attrName) { i++; continue; }

    while (i < len && /\s/.test(html[i])) i++;

    if (i < len && html[i] === '=') {
      i++;
      while (i < len && /\s/.test(html[i])) i++;

      let value = '';

      if (i < len && (html[i] === '"' || html[i] === "'")) {
        const quote    = html[i++];
        const valStart = i;
        while (i < len && html[i] !== quote) i++;
        value = html.slice(valStart, i);
        if (i < len) i++;
      } else {
        // Unquoted values terminate at whitespace or `>` (HTML5 spec §12.1.2.3).
        // Any `/` inside (e.g. href=https://example.com/) is kept verbatim.
        const valStart = i;
        while (i < len && !/[\s>]/.test(html[i])) i++;
        value = html.slice(valStart, i);
      }

      attributes[attrName] = value;
    } else {
      // Boolean attribute — per spec, presence alone implies `true`
      attributes[attrName] = true;
    }
  }

  return { attributes, selfClosing, end: i };
}

// Iterative (not recursive) to avoid call-stack overflow
// on adversarial deeply-nested input.
function filterWhitespace(root) {
  const queue = [root];

  while (queue.length > 0) {
    const node = queue.pop();
    if (!node.children) continue;

    node.children = node.children.filter(function (child) {
      return !(child.type === 'text' && /^\s+$/.test(child.content));
    });

    for (let i = 0; i < node.children.length; i++) {
      if (node.children[i].children) {
        queue.push(node.children[i]);
      }
    }
  }
}

/**
 * Convert an HTML string into a JSON AST.
 *
 * @param  {string} htmlText  Raw HTML string
 * @return {Object}           JSON AST with `type: "document"` root
 */
function html2json(htmlText) {

  if (htmlText == null || typeof htmlText !== 'string') {
    return { type: 'document', children: [] };
  }

  // Top-level try/catch: no matter what pathological input is thrown at us,
  // we return a valid document object instead of propagating an exception.
  try {
    const root           = { type: 'document', children: [] };
    const stack          = [root];
    const openCounts     = new Map();
    let   pos            = 0;
    const len            = htmlText.length;
    let   noPiTerminator = false;

    while (pos < len) {

      // ── Text ──
      if (htmlText[pos] !== '<') {
        const nextLT = htmlText.indexOf('<', pos);
        addTextChild(
          stack,
          nextLT === -1 ? htmlText.slice(pos) : htmlText.slice(pos, nextLT)
        );
        pos = nextLT === -1 ? len : nextLT;
        continue;
      }

      // ── Comment <!--…--> ──
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

      // ── Doctype ──
      if (/^<!doctype[\s>]/i.test(htmlText.slice(pos, pos + 11))) {
        const endIdx = htmlText.indexOf('>', pos);
        const raw    = endIdx === -1
          ? htmlText.slice(pos + 10)
          : htmlText.slice(pos + 10, endIdx);
        addChild(stack, { type: 'doctype', content: raw.trim() });
        pos = endIdx === -1 ? len : endIdx + 1;
        continue;
      }

      // ── CDATA ──
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

      // ── Unknown `<!…>` (SGML relics like <!ENTITY>) — skip gracefully ──
      if (pos + 1 < len && htmlText[pos + 1] === '!') {
        const endIdx = htmlText.indexOf('>', pos);
        pos = endIdx === -1 ? len : endIdx + 1;
        continue;
      }

      // ── Processing instruction `<?…?>` (XML prologue etc.) ──
      if (pos + 1 < len && htmlText[pos + 1] === '?') {
        // Once a scan finds no `?>`, no later `<?` can find one either.
        // Skipping repeated scans keeps runtime linear on unterminated PIs.
        const piEnd = noPiTerminator ? -1 : htmlText.indexOf('?>', pos + 2);
        if (piEnd === -1) noPiTerminator = true;

        if (piEnd !== -1) {
          pos = piEnd + 2;
        } else {
          const gt = htmlText.indexOf('>', pos);
          pos = gt === -1 ? len : gt + 1;
        }
        continue;
      }

      // ── Closing tag ──
      if (pos + 1 < len && htmlText[pos + 1] === '/') {
        const endIdx = htmlText.indexOf('>', pos);
        if (endIdx === -1) {
          // Unterminated closing tag at EOF — emit remainder as text
          // rather than silently swallowing characters.
          addTextChild(stack, htmlText.slice(pos));
          pos = len;
        } else {
          // split(/[\s\/]/) handles malformed closers like `</div  >` or `</br/>`
          const tagName = htmlText.slice(pos + 2, endIdx)
            .trim()
            .split(/[\s\/]/)[0]
            .toLowerCase();
          if (tagName) closeTag(stack, openCounts, tagName);
          pos = endIdx + 1;
        }
        continue;
      }

      // ── Opening tag ──

      let i = pos + 1;

      // Per HTML5 spec, a tag name must begin with an ASCII alpha character.
      // Anything else (e.g. `3 < 5`) is not a tag — emit `<` as literal text.
      if (i >= len || !/[a-zA-Z]/.test(htmlText[i])) {
        addTextChild(stack, '<');
        pos++;
        continue;
      }

      const nameStart = i;
      // Hyphens for custom elements (`<my-widget>`), colons for XML namespaces (`<svg:rect>`)
      while (i < len && /[a-zA-Z0-9\-:]/.test(htmlText[i])) i++;
      const tagName = htmlText.slice(nameStart, i).toLowerCase();

      const { attributes, selfClosing, end } = parseAttributes(htmlText, i);

      const node = {
        type:       'element',
        tag:        tagName,
        attributes: attributes,
        children:   [],
      };

      if (selfClosing || VOID_TAGS.has(tagName)) {
        node.selfClosing = true;
        addChild(stack, node);
        pos = end;
        continue;
      }

      if (RAW_TEXT_TAGS.has(tagName)) {
        addChild(stack, node);

        // Case-insensitive search for closing tag.
        // We intentionally do NOT push onto stack — raw-text elements
        // are closed here immediately, not via the normal closeTag flow.
        const closeRe   = new RegExp('<\\/' + tagName + '\\s*>', 'i');
        const remaining = htmlText.slice(end);
        const match     = closeRe.exec(remaining);

        if (!match) {
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

      addChild(stack, node);
      stack.push(node);
      openCounts.set(tagName, (openCounts.get(tagName) || 0) + 1);
      pos = end;
    }

    filterWhitespace(root);

    return root;

  } catch (_err) {
    return { type: 'document', children: [] };
  }
}

// ── UI helpers (required by index.html) ──

function convertHtml2JsonAndSet() {
  try {
    const htmlTextAreaValue = document.getElementById("html").value;
    const jsonObj = html2json(htmlTextAreaValue);
    const jsonArea = document.getElementById("json");
    try {
      jsonArea.textContent = JSON.stringify(jsonObj, null, 2);
    } catch (_serErr) {
      jsonArea.textContent = JSON.stringify({
        warning: "AST exceeds native JSON.stringify recursion depth limit",
        type: jsonObj.type,
        rootChildrenCount: jsonObj.children ? jsonObj.children.length : 0
      }, null, 2);
    }
  } catch (_err) {
    // UI safety net
  }
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
