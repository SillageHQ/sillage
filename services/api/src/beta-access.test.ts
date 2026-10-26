import assert from "node:assert/strict";
import test from "node:test";
import { betaAccessEnabled, generateBetaCode, hashBetaCode, normalizeBetaCode } from "./beta-access.js";

test("beta access is bypassed outside production only", () => {
  assert.equal(betaAccessEnabled(false, "development"), true);
  assert.equal(betaAccessEnabled(false, "test"), true);
  assert.equal(betaAccessEnabled(false, undefined), true);
  assert.equal(betaAccessEnabled(false, "production"), false);
  assert.equal(betaAccessEnabled(true, "production"), true);
});

test("beta codes are generated in a readable high-entropy format", () => {
  const codes = new Set(Array.from({ length: 100 }, generateBetaCode));
  assert.equal(codes.size, 100);
  for (const code of codes) {
    assert.match(code, /^SIL-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
  }
});

test("beta code hashing ignores case and separators", () => {
  const formatted = "SIL-ABCD-EFGH-JKLM-NPQR";
  assert.equal(normalizeBetaCode(formatted.toLowerCase()), "SILABCDEFGHJKLMNPQR");
  assert.equal(hashBetaCode(formatted), hashBetaCode("sil abcdefgh jklm npqr"));
});
