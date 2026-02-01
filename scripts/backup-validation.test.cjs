const assert = require('node:assert/strict');
const {
  isEncryptedPayload,
  validateBackupPayload,
  totalBackupCount,
} = require('../src/db/backupValidation.js');

function makeValidPayload() {
  return {
    meta: { schemaVersion: 1 },
    identity: { id: 'id', level: 1, totalEffortUnits: 1, createdAt: '', lastActiveAt: '' },
    habits: [],
    effortLogs: [],
    chests: [],
    items: [],
    cards: [],
    chestRewards: [],
    chestMeta: [],
    arcQuestProgress: [],
    combatEncounters: [],
    mercyEvents: [],
    habitEffortCache: [],
  };
}

function run() {
  const encrypted = { __encrypted: true, data: 'x', iv: 'y', salt: 'z' };
  assert.equal(isEncryptedPayload(encrypted), true);
  assert.equal(isEncryptedPayload({}), false);

  const valid = makeValidPayload();
  const validation = validateBackupPayload(valid);
  assert.equal(validation.valid, true);
  assert.equal(totalBackupCount(validation.counts), 1);

  const invalid = { meta: {} };
  const invalidResult = validateBackupPayload(invalid);
  assert.equal(invalidResult.valid, false);

  const empty = makeValidPayload();
  empty.identity = null;
  const emptyResult = validateBackupPayload(empty);
  assert.equal(emptyResult.valid, true);
  assert.equal(totalBackupCount(emptyResult.counts), 0);

  console.log('backup-validation tests: ok');
}

run();
