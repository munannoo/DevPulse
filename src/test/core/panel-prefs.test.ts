import assert from 'node:assert/strict';
import { test } from 'node:test';

test('panel preferences whitelist tabs and collapsible sections, validating restored state', () => {
  const ALLOWED_TABS = ['overview', 'code', 'focus', 'chat'];
  const COLLAPSIBLE_SECTIONS = ['welcome-card', 'left-off', 'pull-requests', 'connection-card', 'skipped'];

  function parseStoredPreferences(raw: unknown) {
    if (!raw || typeof raw !== 'object') { return {}; }
    const obj = raw as Record<string, unknown>;
    const res: { tab?: string; sections?: Record<string, boolean> } = {};
    if (typeof obj.tab === 'string' && ALLOWED_TABS.includes(obj.tab)) {
      res.tab = obj.tab;
    }
    if (obj.sections && typeof obj.sections === 'object') {
      const sections: Record<string, boolean> = {};
      const secObj = obj.sections as Record<string, unknown>;
      for (const id of COLLAPSIBLE_SECTIONS) {
        if (typeof secObj[id] === 'boolean') {
          sections[id] = secObj[id];
        }
      }
      res.sections = sections;
    }
    return res;
  }

  // 1. Valid state restored accurately
  const valid = { tab: 'focus', sections: { 'welcome-card': false, 'connection-card': true } };
  assert.deepEqual(parseStoredPreferences(valid), {
    tab: 'focus',
    sections: { 'welcome-card': false, 'connection-card': true },
  });

  // 2. Untrusted/unknown tab rejected
  const untrustedTab = { tab: 'secret-tab-exploit', sections: {} };
  assert.deepEqual(parseStoredPreferences(untrustedTab), { sections: {} });

  // 3. Non-whitelisted sections and non-boolean values rejected
  const maliciousSections = {
    tab: 'code',
    sections: {
      'welcome-card': true,
      'apiKey': 'leaked-token',
      'arbitrary-id': true,
      'pull-requests': 'not-a-boolean',
    },
  };
  assert.deepEqual(parseStoredPreferences(maliciousSections), {
    tab: 'code',
    sections: { 'welcome-card': true },
  });

  // 4. Null, undefined, primitive, or array payloads handled safely
  assert.deepEqual(parseStoredPreferences(null), {});
  assert.deepEqual(parseStoredPreferences(undefined), {});
  assert.deepEqual(parseStoredPreferences('string'), {});
  assert.deepEqual(parseStoredPreferences(123), {});
  assert.deepEqual(parseStoredPreferences([]), {});
});
