import {
  generateCode,
  generateSalt,
  hashCode,
  normalizeEmail,
  safeEqualHex,
} from '../src/lib/otp';

describe('otp primitives', () => {
  describe('generateCode', () => {
    it('produces a code of the requested length, digits only', () => {
      for (const len of [4, 6, 8]) {
        const code = generateCode(len);
        expect(code).toMatch(new RegExp(`^[0-9]{${len}}$`));
      }
    });

    it('preserves leading zeros via padding', () => {
      // Run many iterations; at least statistically we expect to see short numbers padded.
      const codes = Array.from({ length: 200 }, () => generateCode(6));
      expect(codes.every((c) => c.length === 6)).toBe(true);
    });

    it('rejects unsupported lengths', () => {
      expect(() => generateCode(3)).toThrow();
      expect(() => generateCode(11)).toThrow();
    });
  });

  describe('hashCode', () => {
    const base = { code: '123456', salt: 'aabbcc', purpose: 'login', pepper: 'pep' };

    it('is deterministic for identical inputs', () => {
      expect(hashCode(base)).toBe(hashCode(base));
    });

    it('changes when any input changes', () => {
      const h0 = hashCode(base);
      expect(hashCode({ ...base, code: '654321' })).not.toBe(h0);
      expect(hashCode({ ...base, salt: 'ddeeff' })).not.toBe(h0);
      expect(hashCode({ ...base, purpose: 'signup' })).not.toBe(h0);
      expect(hashCode({ ...base, pepper: 'other' })).not.toBe(h0);
    });

    it('never contains the clear-text code', () => {
      expect(hashCode(base)).not.toContain('123456');
    });
  });

  describe('safeEqualHex', () => {
    it('returns true for identical hex strings', () => {
      const h = hashCode({ code: '111111', salt: generateSalt(), purpose: 'p', pepper: 'k' });
      expect(safeEqualHex(h, h)).toBe(true);
    });

    it('returns false for differing or empty inputs', () => {
      expect(safeEqualHex('aabb', 'ccdd')).toBe(false);
      expect(safeEqualHex('', '')).toBe(false);
      expect(safeEqualHex('aabb', 'aabbcc')).toBe(false);
    });
  });

  describe('normalizeEmail', () => {
    it('lower-cases and trims', () => {
      expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    });
  });
});
