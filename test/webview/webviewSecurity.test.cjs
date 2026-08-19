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
        "&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)",
        "&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3a;alert(1)",
        "java&Tab;script&colon;alert(1)",
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
    assert.equal(security.allowWebviewUrl("https&colon;&sol;&sol;example.com/a"), "https://example.com/a");
    assert.equal(security.allowWebviewUrl("https&#58;&#47;&#x2f;example.com/a"), "https://example.com/a");
});

test("decodes the complete HTML named-reference set before safe reconstruction", () => {
    const sanitized = security.sanitizeHtml(
        '<p title="turn &CounterClockwiseContourIntegral; and divide &frac13;">'
        + 'turn &CounterClockwiseContourIntegral; and divide &frac13;</p>',
    );
    assert.equal(
        sanitized,
        '<p title="turn ∳ and divide ⅓">turn ∳ and divide ⅓</p>',
    );
});

test("handles broken nesting, quotes, NULs, duplicate attributes, and entity attacks", () => {
    const input = '<div><p title="unterminated><img src="javascript:alert(1)"><b>tail'
        + '<a href="https://good.test" href="javascript:alert(1)" o&#110;click="evil">good</a>'
        + '<img src="jav&#x61;script&colon;alert(1)" srcset="https://evil.test 1x">'
        + '<p class="ok bad! also_ok\u0000" title="x\u0000y">end</div>';
    const sanitized = security.sanitizeHtml(input);

    assert.doesNotMatch(sanitized, /javascript|srcset|onclick|unterminated/i);
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

test("enforces input and output limits while preserving balanced safe HTML", () => {
    const inputLimited = security.sanitizeHtmlWithDiagnostics(
        `<div><strong>${"word ".repeat(100)}</strong></div>`,
        { maxInputLength: 80 },
    );
    assert.ok(inputLimited.diagnostics.reasons.includes("input"));
    assert.ok(inputLimited.diagnostics.charactersScanned <= 80);
    assert.equal((inputLimited.html.match(/<div>/g) || []).length, (inputLimited.html.match(/<\/div>/g) || []).length);
    assert.equal((inputLimited.html.match(/<strong>/g) || []).length, (inputLimited.html.match(/<\/strong>/g) || []).length);

    const outputLimited = security.sanitizeHtmlWithDiagnostics(
        `<div><strong>${"<&>".repeat(100)}</strong></div>`,
        { maxOutputLength: 64 },
    );
    assert.ok(outputLimited.diagnostics.reasons.includes("output"));
    assert.ok(outputLimited.html.length <= 64);
    assert.equal(outputLimited.diagnostics.outputLength, outputLimited.html.length);
    assert.equal((outputLimited.html.match(/<div>/g) || []).length, (outputLimited.html.match(/<\/div>/g) || []).length);
    assert.equal((outputLimited.html.match(/<strong>/g) || []).length, (outputLimited.html.match(/<\/strong>/g) || []).length);
    assert.doesNotMatch(outputLimited.html, /&(?!amp;|lt;|gt;|quot;|#39;)/);
});

test("bounds nesting and token work with deterministic operation counters", () => {
    const deeplyNested = `${"<div>".repeat(2_000)}safe${"</div>".repeat(2_000)}`;
    const nestingLimited = security.sanitizeHtmlWithDiagnostics(deeplyNested, {
        maxNestingDepth: 16,
        maxTokens: 10_000,
    });
    assert.ok(nestingLimited.diagnostics.reasons.includes("nesting"));
    assert.equal(nestingLimited.diagnostics.maxObservedNesting, 16);
    assert.ok(nestingLimited.diagnostics.stackOperations <= nestingLimited.diagnostics.tokensProcessed * 2);
    assert.ok(nestingLimited.diagnostics.charactersScanned <= deeplyNested.length * 2);
    assert.equal((nestingLimited.html.match(/<div>/g) || []).length, (nestingLimited.html.match(/<\/div>/g) || []).length);

    const manyTokens = "<b>x</b>".repeat(10_000);
    const tokenLimited = security.sanitizeHtmlWithDiagnostics(manyTokens, { maxTokens: 25 });
    assert.ok(tokenLimited.diagnostics.reasons.includes("tokens"));
    assert.equal(tokenLimited.diagnostics.tokensProcessed, 25);
    assert.ok(tokenLimited.diagnostics.stackOperations <= tokenLimited.diagnostics.tokensProcessed * 2);
    assert.ok(tokenLimited.diagnostics.charactersScanned <= manyTokens.length * 2);
    assert.equal((tokenLimited.html.match(/<b>/g) || []).length, (tokenLimited.html.match(/<\/b>/g) || []).length);
});

test("close-tag handling remains linear for adversarial deep mismatches", () => {
    const depth = 60;
    const input = `${"<div><span>".repeat(depth)}</div>${"</span></div>".repeat(depth)}`;
    const result = security.sanitizeHtmlWithDiagnostics(input, {
        maxNestingDepth: 128,
        maxTokens: 50_000,
    });
    assert.equal(result.diagnostics.truncated, false);
    assert.ok(result.diagnostics.stackOperations <= result.diagnostics.tokensProcessed * 2);
    assert.ok(result.diagnostics.charactersScanned <= input.length * 2);
    assert.equal((result.html.match(/<div>/g) || []).length, (result.html.match(/<\/div>/g) || []).length);
    assert.equal((result.html.match(/<span>/g) || []).length, (result.html.match(/<\/span>/g) || []).length);
});

test("forbidden void and self-closing elements do not consume trailing content", () => {
    const voidInput = ["input", "meta", "source", "embed", "frame"]
        .map((name) => `<${name}>after-${name}`)
        .join("|");
    assert.equal(
        security.sanitizeHtml(voidInput),
        "after-input|after-meta|after-source|after-embed|after-frame",
    );

    const selfClosing = ["script", "style", "svg", "form", "iframe"]
        .map((name) => `<${name}/>after-${name}`)
        .join("|");
    assert.equal(
        security.sanitizeHtml(selfClosing),
        "after-script|after-style|after-svg|after-form|after-iframe",
    );
});

test("nested forbidden containers are dropped once and trailing content is retained", () => {
    const input = "before<form>outer<form>inner</form>outer-tail</form>after"
        + "<script><script>raw</script>after-script";
    const result = security.sanitizeHtmlWithDiagnostics(input);
    assert.equal(result.html, "beforeafterafter-script");
    assert.ok(result.diagnostics.charactersScanned <= input.length * 2);
});
