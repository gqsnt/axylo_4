// Deliberately wrong: create() throws. The run must be recorded as "error", not as a timing. Test use only.
export default {
  id: 'broken-throws', library: 'none', version: 'n/a', config: 'BROKEN: create throws',
  available: () => ({ ok: true }),
  create() { throw new Error('deliberate failure in create'); },
};
