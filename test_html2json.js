// ============================================================
//  test_html2json.js — Automated test suite for html2json
//
//  Run:  node test_html2json.js
//
//  Tests cover:
//    1. Input validation (null, undefined, non-string)
//    2. All 10 HTML sample files — must parse without crashing
//    3. Structural assertions on parser output
//    4. Edge-case stress tests
// ============================================================

const fs   = require('fs');
const path = require('path');

// ---- Load html2json (it's a browser script, so we eval it) ----
const source = fs.readFileSync(
  path.join(__dirname, 'html2json.js'),
  'utf-8'
);

// Remove browser-only functions so Node doesn't choke on `document`
const cleanSource = source
  .replace(/function convertHtml2JsonAndSet\(\)[\s\S]*?^}/m, '')
  .replace(/function showExample1\(\)[\s\S]*?^}/m, '')
  .replace(/function showExample2\(\)[\s\S]*?^}/m, '');

eval(cleanSource);

// ---- Test harness ----
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✅  ${label}`);
  } else {
    failed++;
    console.log(`  ❌  ${label}`);
  }
}

function section(title) {
  console.log(`\n━━━ ${title} ━━━`);
}

// ============================================================
//  1.  Input validation
// ============================================================
section('Input validation');

assert(
  JSON.stringify(html2json(null)) === JSON.stringify({ type: 'document', children: [] }),
  'null → empty document'
);
assert(
  JSON.stringify(html2json(undefined)) === JSON.stringify({ type: 'document', children: [] }),
  'undefined → empty document'
);
assert(
  JSON.stringify(html2json(123)) === JSON.stringify({ type: 'document', children: [] }),
  'number → empty document'
);
assert(
  JSON.stringify(html2json({})) === JSON.stringify({ type: 'document', children: [] }),
  'object → empty document'
);
assert(
  JSON.stringify(html2json([])) === JSON.stringify({ type: 'document', children: [] }),
  'array → empty document'
);
assert(
  JSON.stringify(html2json('')) === JSON.stringify({ type: 'document', children: [] }),
  'empty string → empty document'
);

// ============================================================
//  2.  HTML sample files — parse without crashing
// ============================================================
section('HTML sample files — no-crash test');

const samplesDir = path.join(__dirname, 'html_samples');
const sampleFiles = fs.readdirSync(samplesDir)
  .filter(f => f.endsWith('.html'))
  .sort();

for (const file of sampleFiles) {
  const html = fs.readFileSync(path.join(samplesDir, file), 'utf-8');
  let result;
  let crashed = false;
  try {
    result = html2json(html);
  } catch (e) {
    crashed = true;
  }
  assert(!crashed && result && result.type === 'document' && result.children.length > 0, `${file} → parsed OK`);
}

// ============================================================
//  3.  Structural assertions
// ============================================================
section('Structural assertions');

// 3a.  Simple element
{
  const r = html2json('<p>Hello</p>');
  assert(r.type === 'document', 'root is document');
  assert(r.children.length === 1, 'one child');
  const p = r.children[0];
  assert(p.type === 'element' && p.tag === 'p', 'child is <p>');
  assert(p.children.length === 1 && p.children[0].type === 'text', '<p> has text child');
  assert(p.children[0].content === 'Hello', 'text content is "Hello"');
}

// 3b.  Nested elements
{
  const r = html2json('<div><span><a href="#">Link</a></span></div>');
  const div  = r.children[0];
  const span = div.children[0];
  const a    = span.children[0];
  assert(div.tag === 'div', 'outer is <div>');
  assert(span.tag === 'span', 'middle is <span>');
  assert(a.tag === 'a' && a.attributes.href === '#', 'inner is <a href="#">');
  assert(a.children[0].content === 'Link', 'link text');
}

// 3c.  Void elements
{
  const r = html2json('<br><hr><img src="x.png" alt="test">');
  assert(r.children.length === 3, '3 void elements');
  assert(r.children[0].selfClosing === true, '<br> is selfClosing');
  assert(r.children[1].selfClosing === true, '<hr> is selfClosing');
  assert(r.children[2].tag === 'img' && r.children[2].attributes.src === 'x.png',
    '<img> has correct attributes');
}

// 3c2. Void element with unquoted attribute ending in slash
{
  const r = html2json('<img src=pic.png/>');
  const img = r.children[0];
  assert(img.tag === 'img' && img.attributes.src === 'pic.png/' && img.selfClosing === true,
    '<img src=pic.png/> preserves unquoted value verbatim and closes via VOID_TAGS');
}

// 3d.  Self-closing syntax
{
  const r = html2json('<br/><br />');
  assert(r.children.length === 2, 'two <br> variants');
  assert(r.children[0].selfClosing && r.children[1].selfClosing,
    'both are selfClosing');
}

// 3e.  Boolean attributes
{
  const r = html2json('<input type="text" disabled readonly>');
  const input = r.children[0];
  assert(input.attributes.disabled === true, 'disabled is true');
  assert(input.attributes.readonly === true, 'readonly is true');
  assert(input.attributes.type === 'text', 'type is "text"');
}

// 3f.  Comments
{
  const r = html2json('<!-- hello --><p>text</p>');
  assert(r.children[0].type === 'comment', 'first child is comment');
  assert(r.children[0].content === ' hello ', 'comment content preserved');
  assert(r.children[1].type === 'element', 'second child is element');
}

// 3g.  Doctype
{
  const r = html2json('<!DOCTYPE html><html></html>');
  assert(r.children[0].type === 'doctype', 'first child is doctype');
  assert(r.children[0].content === 'html', 'doctype content is "html"');
}

// 3h.  Tag names normalized to lowercase
{
  const r = html2json('<DIV CLASS="x"><P>Text</P></DIV>');
  assert(r.children[0].tag === 'div', 'DIV → div');
  assert(r.children[0].children[0].tag === 'p', 'P → p');
  assert(r.children[0].attributes.class === 'x', 'CLASS → class');
}

// 3i.  Whitespace-only text filtered
{
  const r = html2json('<div>\n    <p>Text</p>\n</div>');
  const div = r.children[0];
  assert(div.children.length === 1, 'whitespace-only text nodes removed');
  assert(div.children[0].tag === 'p', 'only <p> remains');
}

// 3j.  Script / style raw text
{
  const r = html2json('<script>var x = "<div>";</script>');
  const script = r.children[0];
  assert(script.tag === 'script', 'script element');
  assert(script.children.length === 1, 'one text child');
  assert(script.children[0].content.includes('<div>'),
    'raw content preserved (not parsed as HTML)');
}

// 3k.  Textarea raw text
{
  const r = html2json('<textarea><b>Not bold</b></textarea>');
  const ta = r.children[0];
  assert(ta.tag === 'textarea', 'textarea element');
  assert(ta.children[0].content === '<b>Not bold</b>',
    'textarea content is raw text');
}

// 3l.  Mixed inline content preserves order
{
  const r = html2json('<p>Hello <b>world</b>!</p>');
  const p = r.children[0];
  assert(p.children.length === 3, '3 children: text, <b>, text');
  assert(p.children[0].content === 'Hello ', 'text before');
  assert(p.children[1].tag === 'b', 'bold element');
  assert(p.children[2].content === '!', 'text after');
}

// 3m.  Multiple root-level elements
{
  const r = html2json('<p>A</p><p>B</p><p>C</p>');
  assert(r.children.length === 3, '3 root-level <p> elements');
}

// 3n.  CDATA
{
  const r = html2json('<![CDATA[some <raw> & data]]>');
  assert(r.children[0].type === 'cdata', 'CDATA node');
  assert(r.children[0].content === 'some <raw> & data', 'CDATA content');
}

// ============================================================
//  4.  Crash resilience & malformed input structural assertions
// ============================================================
section('Crash resilience & malformed inputs');

// 4a.  Unclosed tags build valid nested hierarchy
{
  const r = html2json('<div><p><span>text');
  assert(
    r.children.length === 1 &&
    r.children[0].tag === 'div' &&
    r.children[0].children[0].tag === 'p' &&
    r.children[0].children[0].children[0].tag === 'span' &&
    r.children[0].children[0].children[0].children[0].content === 'text',
    'unclosed tags build valid nested hierarchy'
  );
}

// 4b.  Stray closing tags ignored without affecting siblings
{
  const r = html2json('</div></span></foo><p>valid</p></bar>');
  assert(
    r.children.length === 1 &&
    r.children[0].tag === 'p' &&
    r.children[0].children[0].content === 'valid',
    'stray closing tags ignored without affecting valid elements'
  );
}

// 4c.  Mismatched nesting closes innermost matching tag
{
  const r = html2json('<b><i>text</b></i>');
  assert(
    r.children.length === 1 &&
    r.children[0].tag === 'b' &&
    r.children[0].children[0].tag === 'i' &&
    r.children[0].children[0].children[0].content === 'text',
    'mismatched nesting closes matched tag and implicitly popped tags'
  );
}

// 4d.  Plain text with < and > preserved as single text node
{
  const r = html2json('3 < 5 and 10 > 7');
  assert(
    r.children.length === 1 &&
    r.children[0].type === 'text' &&
    r.children[0].content === '3 < 5 and 10 > 7',
    'math expressions with < > preserved as single text node'
  );
}

// 4e.  Incomplete tag at EOF parses available attributes
{
  const r = html2json('<div class="oops');
  assert(
    r.children.length === 1 &&
    r.children[0].tag === 'div' &&
    r.children[0].attributes.class === 'oops',
    'incomplete tag at EOF parses available attributes'
  );
}

// 4f.  Very long input
{
  const bigHtml = '<ul>' + '<li>Item</li>'.repeat(10000) + '</ul>';
  const r = html2json(bigHtml);
  assert(r.children[0].children.length === 10000, '10k list items parsed completely');
}

// 4g.  Deeply nested elements and safe serialization
{
  const depth = 300;
  const deep = '<div>'.repeat(depth) + 'deep' + '</div>'.repeat(depth);
  const r = html2json(deep);
  assert(r.children.length === 1, '300-level deep nesting parsed successfully');
  let serialized = false;
  try {
    JSON.stringify(r);
    serialized = true;
  } catch (e) {}
  assert(serialized, '300-level deep AST serializes safely without RangeError');
}

// 4h.  Null bytes in input
{
  const r = html2json('<p>Hello\0World</p>');
  assert(r.children[0].children[0].content === 'Hello\0World', 'null bytes preserved in text');
}

// 4i.  Only whitespace yields empty children
{
  const r = html2json('   \n\t\n   ');
  assert(r.children.length === 0, 'whitespace-only input → empty children');
}

// 4j.  Angle brackets that aren't tags
{
  const r = html2json('<<< >>> <> </> <123> <.>');
  assert(
    r.type === 'document' &&
    r.children.length === 1 &&
    r.children[0].type === 'text' &&
    r.children[0].content === '<<< >>> <>  <123> <.>',
    'random angle brackets become a single text node without crashing'
  );
}

// 4k.  Unterminated comment captured to EOF
{
  const r = html2json('<!-- unclosed comment text');
  assert(
    r.children.length === 1 &&
    r.children[0].type === 'comment' &&
    r.children[0].content === ' unclosed comment text',
    'unterminated comment captured to EOF'
  );
}

// 4l.  Unterminated CDATA captured to EOF
{
  const r = html2json('<![CDATA[raw data without closing');
  assert(
    r.children.length === 1 &&
    r.children[0].type === 'cdata' &&
    r.children[0].content === 'raw data without closing',
    'unterminated CDATA captured to EOF'
  );
}

// 4m.  Unterminated, lowercase, and bare DOCTYPE declarations
{
  const r1 = html2json('<!DOCTYPE html');
  assert(r1.children[0].type === 'doctype' && r1.children[0].content === 'html', 'unterminated doctype captured');

  const r2 = html2json('<!doctype html>');
  assert(r2.children[0].type === 'doctype' && r2.children[0].content === 'html', 'lowercase doctype captured');

  const r3 = html2json('<!DOCTYPE>');
  assert(r3.children[0].type === 'doctype' && r3.children[0].content === '', 'bare doctype captured with empty content');
}

// 4n.  XML processing instruction and unknown entity declarations skipped
{
  const r = html2json('<?xml version="1.0" encoding="UTF-8"?><!ENTITY test "val"><p>Hello</p>');
  assert(
    r.children.length === 1 &&
    r.children[0].tag === 'p' &&
    r.children[0].children[0].content === 'Hello',
    'processing instructions and unknown <! declarations skipped cleanly'
  );
}

// 4o.  Unterminated raw-text elements (<script>, <textarea>) and uppercase closers
{
  const r1 = html2json('<script>console.log("unclosed");');
  assert(
    r1.children[0].tag === 'script' &&
    r1.children[0].children[0].content === 'console.log("unclosed");',
    'unterminated script captured as verbatim text'
  );

  const r2 = html2json('<script>var x = 1;</SCRIPT><p>after</p>');
  assert(
    r2.children.length === 2 &&
    r2.children[0].tag === 'script' &&
    r2.children[1].tag === 'p',
    'uppercase </SCRIPT> closes script element correctly'
  );

  const r3 = html2json('<textarea>raw text without end');
  assert(
    r3.children[0].tag === 'textarea' &&
    r3.children[0].children[0].content === 'raw text without end',
    'unterminated textarea captured as verbatim text'
  );
}

// 4p.  Whitespace-padded closers and void closers
{
  const r = html2json('<div>test</div  ></br></input>');
  assert(
    r.children.length === 1 &&
    r.children[0].tag === 'div' &&
    r.children[0].children[0].content === 'test',
    'whitespace-padded closer works and stray void closers ignored'
  );
}

// 4q.  Duplicate attributes collapse with last-wins policy
{
  const r = html2json('<div class="first" class="second"></div>');
  assert(r.children[0].attributes.class === 'second', 'duplicate attributes collapse with last-wins policy');
}

// 4r.  __proto__, hasOwnProperty, toString preserved without prototype pollution
{
  const r = html2json('<div __proto__="safe" hasOwnProperty="yes" toString="val" constructor="obj"></div>');
  const attrs = r.children[0].attributes;
  assert(
    attrs.__proto__ === 'safe' &&
    attrs.hasownproperty === 'yes' &&
    attrs.tostring === 'val' &&
    attrs.constructor === 'obj' &&
    Object.getPrototypeOf(attrs) === null,
    '__proto__, hasOwnProperty, and constructor preserved safely in null-prototype map'
  );
}

// 4s.  Unquoted attribute ending with slash inside container element
{
  const r = html2json('<a href=https://example.com/>Link</a>');
  const a = r.children[0];
  assert(
    a.tag === 'a' &&
    a.attributes.href === 'https://example.com/' &&
    !a.selfClosing &&
    a.children[0].content === 'Link',
    'unquoted URL with trailing slash preserved verbatim and container not marked selfClosing'
  );
}

// 4t.  Linear scaling on unmatched closers (openCounts map optimization)
{
  // Warm up JIT
  html2json('<div>'.repeat(500) + '</x>'.repeat(500));

  const n1 = 2000;
  const input1 = '<div>'.repeat(n1) + '</x>'.repeat(n1);
  const t1Start = process.hrtime.bigint();
  html2json(input1);
  const t1End = process.hrtime.bigint();
  const ms1 = Math.max(Number(t1End - t1Start) / 1e6, 0.01);

  const n2 = 8000; // 4x input size
  const input2 = '<div>'.repeat(n2) + '</x>'.repeat(n2);
  const t2Start = process.hrtime.bigint();
  html2json(input2);
  const t2End = process.hrtime.bigint();
  const ms2 = Number(t2End - t2Start) / 1e6;

  // On a quadratic O(N^2) stack scan (2000 vs 8000), 4x input size causes 16x execution time.
  // With O(1) Map lookup, growth is linear (~4x). We assert ratio < 10x to strictly reject O(N^2).
  const scalingRatio = ms2 / ms1;
  assert(
    scalingRatio < 10,
    `unmatched closers scale linearly: ratio ${scalingRatio.toFixed(2)}x for 4x input (< 10x, rejecting O(N^2))`
  );
  assert(ms2 < 200, `unmatched closers (n=8000) executed in ${ms2.toFixed(2)}ms (< 200ms)`);
}

// 4u.  Linear time on repeated unterminated processing instructions (noPiTerminator optimization)
{
  const n = 10000;
  const input = '<?a>'.repeat(n);
  const t0 = process.hrtime.bigint();
  const r = html2json(input);
  const t1 = process.hrtime.bigint();
  const elapsedMs = Number(t1 - t0) / 1e6;
  assert(
    r.type === 'document' && elapsedMs < 100,
    `10k unterminated processing instructions parsed in ${elapsedMs.toFixed(2)}ms (< 100ms)`
  );
}

// ============================================================
//  Summary
// ============================================================
console.log('\n' + '═'.repeat(50));
console.log(`  Total: ${passed + failed}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
console.log('═'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
