#!/usr/bin/env bash
#
# Obsidian CLI integration tests for Pubcopy.
#
# Builds the plugin, deploys it to a test vault, runs conversion commands
# via the Obsidian CLI, and validates the output against expected patterns.
#
# Usage:
#   ./tests/cli/run-cli-tests.sh [vault-name]
#
# Arguments:
#   vault-name  Name of the Obsidian vault to test against (default: obs_drop_test)
#
# Prerequisites:
#   - Obsidian desktop app installed at /Applications/Obsidian.app (macOS)
#   - The test vault must already exist and be registered in Obsidian
#   - The pubcopy plugin must be enabled in the vault's community plugins list
#
# The script exits with code 0 if all tests pass, 1 otherwise.

set -euo pipefail

VAULT_NAME="${1:-obs_drop_test}"
OBSIDIAN="/Applications/Obsidian.app/Contents/MacOS/obsidian"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FIXTURES_DIR="$SCRIPT_DIR/fixtures"

# Output prefix for temp files written into the vault
OUTPUT_PREFIX="_pubcopy_cli_test"

# Counters
PASS=0
FAIL=0
TOTAL=0

# Colors (if terminal supports them)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN='' RED='' BOLD='' RESET=''
fi

# ---------- helpers ----------

log()   { echo -e "${BOLD}$*${RESET}"; }
pass()  { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); echo -e "  ${GREEN}✓${RESET} $1"; }
fail()  { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); echo -e "  ${RED}✗${RESET} $1"; echo -e "    ${RED}$2${RESET}"; }

# Run an Obsidian CLI eval and return just the result value.
obsidian_eval() {
  "$OBSIDIAN" eval vault="$VAULT_NAME" code="$1" 2>&1 | grep "^=>" | sed 's/^=> //'
}

# Run a conversion command and write the HTML/plain output to vault files.
#
# Intercepts navigator.clipboard.write() to capture output to files,
# since the Web Clipboard API requires document focus which is unavailable
# in CLI context.
#
# Args: $1=note-name (without .md), $2=command-id, $3=output-suffix
run_conversion() {
  local note="$1" cmd="$2" suffix="$3"
  local html_out="${OUTPUT_PREFIX}_${suffix}.html"
  local txt_out="${OUTPUT_PREFIX}_${suffix}.txt"
  local err_out="${OUTPUT_PREFIX}_${suffix}_err.txt"

  # Clear stale output from previous runs
  rm -f "$VAULT_PATH/$html_out" "$VAULT_PATH/$txt_out" "$VAULT_PATH/$err_out"

  local js="
navigator.clipboard.write = function(data) {
  return data[0].getType('text/html').then(function(blob) {
    return blob.text();
  }).then(function(html) {
    return app.vault.adapter.write('${html_out}', html);
  }).then(function() {
    return data[0].getType('text/plain').then(function(blob) { return blob.text(); });
  }).then(function(plain) {
    return app.vault.adapter.write('${txt_out}', plain);
  });
};
app.workspace.openLinkText('${note}', '', false).then(function() {
  return app.commands.executeCommandById('${cmd}');
}).catch(function(e) {
  app.vault.adapter.write('${err_out}', e.message);
});
'done'
"
  "$OBSIDIAN" eval vault="$VAULT_NAME" code="$js" >/dev/null 2>&1 || return 1

  # Poll for output files instead of sleeping a fixed duration
  local i
  for i in $(seq 1 20); do
    [ -e "$VAULT_PATH/$err_out" ] && return 1
    if [ -e "$VAULT_PATH/$html_out" ] || [ -e "$VAULT_PATH/$txt_out" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# Read a test output file from the vault.
read_vault_file() {
  cat "$VAULT_PATH/$1" 2>/dev/null || echo ""
}

# Assert that a string contains a substring
assert_contains() {
  local haystack="$1" needle="$2" label="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    pass "$label"
  else
    fail "$label" "expected to contain: $needle"
  fi
}

# Assert that a string does NOT contain a substring
assert_not_contains() {
  local haystack="$1" needle="$2" label="$3"
  if echo "$haystack" | grep -qF "$needle"; then
    fail "$label" "should not contain: $needle"
  else
    pass "$label"
  fi
}

# Assert content is non-empty
assert_nonempty() {
  local content="$1" label="$2"
  if [ -n "$content" ]; then
    pass "$label"
  else
    fail "$label" "output was empty"
  fi
}

# ---------- preflight ----------

log "Preflight checks"

if [ ! -x "$OBSIDIAN" ]; then
  echo -e "${RED}Error: Obsidian CLI not found at $OBSIDIAN${RESET}"
  echo "Install Obsidian from https://obsidian.md/download"
  exit 1
fi

# Verify vault is accessible
VAULT_CHECK=$(obsidian_eval "typeof app.vault")
if [ "$VAULT_CHECK" != "object" ]; then
  echo -e "${RED}Error: Cannot connect to vault '$VAULT_NAME'${RESET}"
  echo "Ensure the vault exists and Obsidian is running."
  exit 1
fi
pass "Obsidian CLI connected to vault '$VAULT_NAME'"

VAULT_PATH=$(obsidian_eval "app.vault.adapter.basePath")
if [ -z "$VAULT_PATH" ] || [ ! -d "$VAULT_PATH" ]; then
  echo -e "${RED}Error: Could not determine vault path${RESET}"
  exit 1
fi
pass "Vault path: $VAULT_PATH"

# ---------- build & deploy ----------

log "Building and deploying plugin"

cd "$PROJECT_DIR"
npm run build > /dev/null 2>&1
pass "Plugin built"

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/pubcopy"
mkdir -p "$PLUGIN_DIR"
cp main.js manifest.json "$PLUGIN_DIR/"
[ -f styles.css ] && cp styles.css "$PLUGIN_DIR/" || true
pass "Plugin deployed to vault"

# Deploy test fixtures
for fixture in "$FIXTURES_DIR"/*.md; do
  cp "$fixture" "$VAULT_PATH/"
done
pass "Test fixtures deployed"

# Reload plugin
if "$OBSIDIAN" plugin:reload vault="$VAULT_NAME" id=pubcopy >/dev/null 2>&1; then
  sleep 1
  pass "Plugin reloaded"
else
  fail "Plugin reload" "Obsidian CLI failed to reload pubcopy"
  exit 1
fi

# Verify plugin is loaded
PLUGIN_CHECK=$(obsidian_eval "app.plugins.plugins['pubcopy'] ? 'loaded' : 'missing'")
if [ "$PLUGIN_CHECK" = "loaded" ]; then
  pass "Plugin loaded in vault"
else
  echo -e "${RED}Error: Plugin not loaded. Enable it in Obsidian settings.${RESET}"
  exit 1
fi

# Verify commands registered
CMD_CHECK=$(obsidian_eval "['pubcopy:copy-for-medium','pubcopy:copy-for-substack','pubcopy:copy-as-markdown'].filter(function(c){return !app.commands.commands[c]}).length === 0 ? 'ok' : 'missing'")
if [ "$CMD_CHECK" = "ok" ]; then
  pass "All 3 commands registered"
else
  fail "Command registration" "Some commands are missing"
fi

# ---------- Test 1: Basic conversion (Medium) ----------

log "Test: Basic conversion (Medium)"

run_conversion "pubcopy-test-basic" "pubcopy:copy-for-medium" "basic_medium"
HTML=$(read_vault_file "${OUTPUT_PREFIX}_basic_medium.html")
PLAIN=$(read_vault_file "${OUTPUT_PREFIX}_basic_medium.txt")

assert_nonempty "$HTML" "HTML output is non-empty"
assert_nonempty "$PLAIN" "Plain text output is non-empty"
assert_contains "$HTML" "<h1>Hello World</h1>" "H1 rendered"
assert_contains "$HTML" "<strong>bold</strong>" "Bold rendered"
assert_contains "$HTML" "<em>italic</em>" "Italic rendered"
assert_contains "$HTML" "<li>Item 1</li>" "List items rendered"
assert_contains "$HTML" "<blockquote>" "Blockquote rendered"
assert_contains "$HTML" "language-python" "Code block with language"
assert_contains "$HTML" "def hello():" "Code content preserved"
assert_not_contains "$HTML" "title: Test Note" "Frontmatter stripped"
assert_contains "$HTML" "wikilink" "Wikilink text preserved"
assert_not_contains "$HTML" "[[wikilink]]" "Wikilink syntax stripped"
assert_not_contains "$HTML" "#tag" "Tag stripped"

# ---------- Test 2: Security / XSS prevention ----------

log "Test: Security / XSS prevention"

run_conversion "pubcopy-test-security" "pubcopy:copy-for-medium" "security_medium"
HTML=$(read_vault_file "${OUTPUT_PREFIX}_security_medium.html")

assert_nonempty "$HTML" "Security test produced output"
assert_not_contains "$HTML" "<script>" "Script tags stripped"
assert_not_contains "$HTML" "</script>" "Closing script tags stripped"
assert_not_contains "$HTML" "<iframe" "Iframe stripped"
assert_not_contains "$HTML" "onerror" "Event handlers stripped"
assert_not_contains "$HTML" "javascript:" "javascript: URIs stripped"
assert_contains "$HTML" "<strong>highlighted text</strong>" "Highlights render as <strong>"
assert_contains "$HTML" "<strong>Warning:</strong>" "Callout converted"
assert_contains "$HTML" "☐" "Unchecked task checkbox"
assert_contains "$HTML" "☑" "Checked task checkbox"
assert_contains "$HTML" "katex" "Inline math rendered (KaTeX)"
assert_contains "$HTML" "math-block" "Block math rendered"

# ---------- Test 3: Embed resolution ----------

log "Test: Embed resolution"

run_conversion "pubcopy-test-embeds" "pubcopy:copy-for-medium" "embeds_medium"
HTML=$(read_vault_file "${OUTPUT_PREFIX}_embeds_medium.html")

assert_nonempty "$HTML" "Embed test produced output"
assert_contains "$HTML" "Embedded Content" "Full note embed resolved"
assert_contains "$HTML" "Section A" "Heading section present"
assert_contains "$HTML" "Content from section A" "Section content inlined"
assert_not_contains "$HTML" "![[" "No raw embed syntax in output"
assert_contains "$HTML" "Done" "Text after embeds preserved"

# ---------- Test 4: Substack output ----------

log "Test: Substack output (platform differences)"

run_conversion "pubcopy-test-basic" "pubcopy:copy-for-substack" "basic_substack"
HTML=$(read_vault_file "${OUTPUT_PREFIX}_basic_substack.html")

assert_nonempty "$HTML" "Substack output is non-empty"
assert_contains "$HTML" "<pre " "Code blocks use <pre>"
assert_not_contains "$HTML" "<pre><code" "No <pre><code> wrapper (pre-only mode)"

# ---------- Test 5: Markdown output ----------

log "Test: Markdown output mode"

run_conversion "pubcopy-test-basic" "pubcopy:copy-as-markdown" "basic_markdown"
PLAIN=$(read_vault_file "${OUTPUT_PREFIX}_basic_markdown.txt")

assert_nonempty "$PLAIN" "Markdown output is non-empty"
assert_contains "$PLAIN" "# Hello World" "Heading preserved in markdown"
assert_contains "$PLAIN" "**bold**" "Bold markdown preserved"
assert_not_contains "$PLAIN" "[[wikilink]]" "Wikilinks stripped in markdown"
assert_not_contains "$PLAIN" "title: Test Note" "Frontmatter stripped in markdown"

# ---------- cleanup ----------

log "Cleanup"

for f in "$VAULT_PATH"/${OUTPUT_PREFIX}_*; do
  [ -e "$f" ] && rm -f "$f"
done
pass "Test output files removed"

# ---------- summary ----------

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All $TOTAL tests passed.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}$FAIL of $TOTAL tests failed.${RESET}"
  exit 1
fi
