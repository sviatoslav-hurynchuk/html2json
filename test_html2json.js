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
  assert(!crashed && result && result.type === 'document', `${file} → parsed OK`);
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
//  4.  Crash resilience — stress tests
// ============================================================
section('Crash resilience');

// 4a.  Unclosed tags
{
  let crashed = false;
  try { html2json('<div><p><span>text'); } catch(e) { crashed = true; }
  assert(!crashed, 'unclosed tags do not crash');
}

// 4b.  Stray closing tags
{
  let crashed = false;
  try { html2json('</div></span></foo></bar>'); } catch(e) { crashed = true; }
  assert(!crashed, 'stray closing tags do not crash');
}

// 4c.  Mismatched nesting
{
  let crashed = false;
  try { html2json('<b><i>text</b></i>'); } catch(e) { crashed = true; }
  assert(!crashed, 'mismatched nesting does not crash');
}

// 4d.  Plain text with < and >
{
  const r = html2json('3 < 5 and 10 > 7');
  let crashed = false;
  try { JSON.stringify(r); } catch(e) { crashed = true; }
  assert(!crashed, 'math expressions with < > do not crash');
}

// 4e.  Incomplete tag at EOF
{
  let crashed = false;
  try { html2json('<div class="oops'); } catch(e) { crashed = true; }
  assert(!crashed, 'incomplete tag at EOF does not crash');
}

// 4f.  Very long input
{
  const bigHtml = '<ul>' + '<li>Item</li>'.repeat(10000) + '</ul>';
  let crashed = false;
  try { html2json(bigHtml); } catch(e) { crashed = true; }
  assert(!crashed, '10k list items do not crash');
}

// 4g.  Deeply nested (200 levels)
{
  const deep = '<div>'.repeat(200) + 'deep' + '</div>'.repeat(200);
  let crashed = false;
  try { html2json(deep); } catch(e) { crashed = true; }
  assert(!crashed, '200-level deep nesting does not crash');
}

// 4h.  Null bytes in input
{
  let crashed = false;
  try { html2json('<p>Hello\0World</p>'); } catch(e) { crashed = true; }
  assert(!crashed, 'null bytes in input do not crash');
}

// 4i.  Only whitespace
{
  const r = html2json('   \n\t\n   ');
  assert(r.children.length === 0, 'whitespace-only input → empty children');
}

// 4j.  Angle brackets that aren't tags
{
  let crashed = false;
  try { html2json('<<< >>> <> </> <123> <.>'); } catch(e) { crashed = true; }
  assert(!crashed, 'random angle brackets do not crash');
}

// ============================================================
//  Summary
// ============================================================
console.log('\n' + '═'.repeat(50));
console.log(`  Total: ${passed + failed}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
console.log('═'.repeat(50));

process.exit(failed > 0 ? 1 : 0);
