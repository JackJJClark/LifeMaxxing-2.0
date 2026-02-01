export function isEncryptedPayload(payload) {
  // Backup envelope marker: encrypted payloads must be decrypted before import.
  const hasEnvelope =
    payload &&
    typeof payload === 'object' &&
    payload.__encrypted === true &&
    payload.data &&
    payload.iv &&
    payload.salt;
  return Boolean(hasEnvelope);
}

export function validateBackupPayload(payload) {
  // Validate required top-level shape to prevent wiping on malformed imports.
  if (!payload || typeof payload !== 'object') {
    return { valid: false, reason: 'Backup payload is missing or invalid.' };
  }
  const requiredArrays = [
    'habits',
    'effortLogs',
    'chests',
    'items',
    'cards',
    'chestRewards',
    'chestMeta',
    'arcQuestProgress',
    'combatEncounters',
    'mercyEvents',
    'habitEffortCache',
  ];
  const counts = {};
  for (const key of requiredArrays) {
    if (!Array.isArray(payload[key])) {
      return { valid: false, reason: `Backup payload missing array: ${key}.` };
    }
    counts[key] = payload[key].length;
  }
  counts.identity = payload.identity ? 1 : 0;
  return { valid: true, counts };
}

export function totalBackupCount(counts) {
  const values = counts || {};
  return (
    (values.identity || 0) +
    Object.keys(values)
      .filter((key) => key !== 'identity')
      .reduce((sum, key) => sum + (values[key] || 0), 0)
  );
}
