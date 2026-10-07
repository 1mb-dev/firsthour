// Phrases, never bare words: bare "unpaid" drops fintech roles about unpaid invoices, bare
// "exposure" (even "for exposure") drops risk and security roles. Each entry has a test in test/select.test.ts.
export const DENY_PHRASES: readonly string[] = [
  'unpaid position',
  'unpaid role',
  'unpaid internship',
  'unpaid opportunity',
  'this is unpaid',
  'volunteer position',
  'volunteer role',
  'volunteer basis',
  'volunteer opportunity',
  'work for exposure',
  'in exchange for exposure',
  'paid in exposure',
  'equity only',
  'equity-only',
];
