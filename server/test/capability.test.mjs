// Unit tests for capability tiers (D3 / Phase 4). Pure classification + tier-budget invariants;
// the live probe is exercised over HTTP in scripts/verify-ph4-d3.mjs.
// Run after `npm run build`. `node --test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyByName, TIERS } from '../dist/capability.js'

test('name classification maps cheap families to fast', () => {
  for (const m of [
    'claude-haiku-4-5',
    'gpt-4o-mini',
    'gemini-1.5-flash',
    'llama-3-8b',
    'phi-3',
    'ministral-3b',
  ]) {
    assert.equal(classifyByName(m), 'fast', `${m} → fast`)
  }
})

test('name classification maps flagship/deep families to deep', () => {
  for (const m of ['claude-opus-4-8', 'gpt-5', 'o1-preview', 'o3', 'llama-3-70b']) {
    assert.equal(classifyByName(m), 'deep', `${m} → deep`)
  }
})

test('unknown / mid models default to standard', () => {
  for (const m of ['claude-sonnet-5', 'gpt-4o', 'mock-1', 'some-custom-model']) {
    assert.equal(classifyByName(m), 'standard', `${m} → standard`)
  }
})

test('a fast marker wins over a deep-looking token (o3-mini is fast)', () => {
  // FAST is checked before DEEP, so a small variant of a flagship line is treated as fast.
  assert.equal(classifyByName('o3-mini'), 'fast')
  assert.equal(classifyByName('gpt-4o-mini'), 'fast')
})

test('tier budgets are ordered: fast is tighter, standard == deep ceiling', () => {
  assert.ok(TIERS.fast.interviewMax < TIERS.standard.interviewMax, 'fast interview budget is smaller')
  assert.ok(TIERS.fast.evalMax < TIERS.standard.evalMax, 'fast eval budget is smaller')
  assert.equal(TIERS.standard.interviewMax, TIERS.deep.interviewMax, 'standard + deep share the ceiling')
  assert.equal(TIERS.standard.guidance, '', 'standard tier adds no extra guidance')
  assert.ok(TIERS.fast.guidance.includes('MODEL NOTE'), 'fast tier injects a model note')
  assert.ok(TIERS.deep.guidance.includes('MODEL NOTE'), 'deep tier injects a model note')
})
