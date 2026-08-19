const assert = require("node:assert/strict");
const test = require("node:test");

const security = require("../../out-test/webview/webviewSecurity.js");

test("sanitizes executable, foreign, form, SVG, CSS, and event payloads", () => {
    const hostile = [
        '<p onclick="alert(1)" style="background:url(javascript:1)" id="owned">safe</p>',
        '<script><script>alert(1)</script><img src=x onerror=alert(2)>',
        '<STYLE>@import "https://evil.test"</STYLE>',
        '<svg><a xlink:href="javascript:alert(1)"><circle /></a></svg>',
        '<math><mtext><img src="https://evil.test/x" onerror="x"></mtext></math>',
        '<form><input name="x"><button>send</button></form>',
        '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    ].join("");

    const sanitized = security.sanitizeHtml(hostile);
    assert.equal(sanitized, "<p>safe</p>");
    assert.doesNotMatch(sanitized, /script|style=|onclick|onerror|svg|math|form|iframe|srcdoc/i);
});

test("preserves a balanced safe subset and HTTPS or fragment URLs", () => {
    const input = '<details class="hint-accordion" open><summary>Hint</summary><p>Use <strong>A &amp; B</strong>'
        + '<a href="https://example.com/docs?q=1&amp;x=2" target="_blank">docs</a>'
        + '<a href="#overview">top</a><img src="https://example.com/a.png" alt="A &quot; B"></details>';
    const sanitized = security.sanitizeHtml(input);

    assert.match(sanitized, /^<details class="hint-accordion" open>/);
    assert.match(sanitized, /<strong>A &amp; B<\/strong>/);
    assert.match(sanitized, /href="https:\/\/example\.com\/docs\?q=1&amp;x=2"/);
    assert.match(sanitized, /href="#overview"/);
    assert.match(sanitized, /src="https:\/\/example\.com\/a\.png"/);
    assert.doesNotMatch(sanitized, /target=/);
    assert.equal((sanitized.match(/<details/g) || []).length, (sanitized.match(/<\/details>/g) || []).length);
});

test("rejects executable, local, protocol-relative, encoded, and malformed URLs", () => {
    const rejected = [
        "javascript:alert(1)",
        "JaVaScRiPt:alert(1)",
        "jav&#x61;script&colon;alert(1)",
        "java&#9;script:alert(1)",
        "command:leetnotion.signin",
        "file:///etc/passwd",
        "//example.com/path",
        "https:example.com",
        "https://exa mple.com",
        "https://example.com/\\@evil.test",
        "\u0000https://example.com",
    ];
    for (const value of rejected) {
        assert.equal(security.allowWebviewUrl(value), undefined, value);
    }
    assert.equal(security.allowWebviewUrl("#description"), "#description");
    assert.equal(security.allowWebviewUrl("https://example.com/a"), "https://example.com/a");
});

test("handles broken nesting, quotes, NULs, duplicate attributes, and entity attacks", () => {
    const input = '<div><p title="unterminated><img src="javascript:alert(1)"><b>tail'
        + '<a href="https://good.test" href="javascript:alert(1)" o&#110;click="evil">good</a>'
        + '<img src="jav&#x61;script&colon;alert(1)" srcset="https://evil.test 1x">'
        + '<p class="ok bad! also_ok\u0000" title="x\u0000y">end</div>';
    const sanitized = security.sanitizeHtml(input);

    assert.doesNotMatch(sanitized, /javascript|srcset|onclick/i);
    assert.match(sanitized, /<a href="https:\/\/good\.test\/">good<\/a>/);
    assert.match(sanitized, /class="ok also_ok"/);
    assert.equal((sanitized.match(/<div/g) || []).length, (sanitized.match(/<\/div>/g) || []).length);
});

test("safe JSON cannot terminate its HTML container", () => {
    const serialized = security.serializeJsonForHtml({ payload: "</script><script>alert('&')</script>\u2028" });
    assert.doesNotMatch(serialized, /[<>&\u2028\u2029]/u);
    assert.deepEqual(JSON.parse(serialized), { payload: "</script><script>alert('&')</script>\u2028" });
});

test("strict CSP uses a nonce without unsafe directives", () => {
    const csp = security.createWebviewCsp("webview-resource:", "abcDEF123+/=");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src webview-resource: 'nonce-abcDEF123\+\/=+'/);
    assert.match(csp, /style-src webview-resource: 'nonce-abcDEF123\+\/=+'/);
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|command:|file:/);
});
