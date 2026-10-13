import { describe, expect, it } from 'vitest';
import { canAssess, canPredict, parseImport, validateValues } from './api';
import type { FeatureSchema, User } from './api';

const schema: FeatureSchema = {
  feature_order: ['radius_mean', 'texture_mean'], groups: [], disclaimer: '',
  features: ['radius_mean', 'texture_mean'].map(name => ({ name, label: name, group: 'mean', description: '', minimum: 0, unit: null })),
};
const user = (role: User['role'], approved = true): User => ({ id: 1, username: 'sample', role, approved });

describe('role permissions', () => {
  it('keeps guest, patient and pending staff out of assessment tools', () => {
    expect(canAssess(null)).toBe(false);
    expect(canAssess(user('patient'))).toBe(false);
    expect(canAssess(user('doctor', false))).toBe(false);
    expect(canAssess(user('researcher', false))).toBe(false);
  });
  it('allows student practice but reserves prediction for approved staff', () => {
    expect(canAssess(user('student'))).toBe(true);
    expect(canPredict(user('student'))).toBe(false);
    expect(canPredict(user('doctor'))).toBe(true);
    expect(canPredict(user('researcher'))).toBe(true);
  });
});

describe('measurement intake', () => {
  it('rejects empty, negative and non-finite values and accepts zero', () => {
    expect(validateValues({ radius_mean: '', texture_mean: '-2' }, schema)).toHaveProperty('radius_mean');
    expect(validateValues({ radius_mean: 'Infinity', texture_mean: '0' }, schema)).toHaveProperty('radius_mean');
    expect(validateValues({ radius_mean: '0', texture_mean: '1.3e-2' }, schema)).toEqual({});
  });
  it('imports a complete named payload without relying on key order', () => {
    expect(parseImport('{"features":{"texture_mean":2,"radius_mean":1},"sample_id":"test"}', schema))
      .toEqual({ sample_id: 'test', values: { radius_mean: '1', texture_mean: '2' } });
  });
  it('rejects unexpected fields and numeric strings in imported files', () => {
    expect(() => parseImport('{"features":{"radius_mean":1}}', schema)).toThrow();
    expect(() => parseImport('{"features":{"radius_mean":"1","texture_mean":2}}', schema)).toThrow();
    expect(() => parseImport('{"features":{"radius_mean":1,"texture_mean":2},"diagnosis":"x"}', schema)).toThrow();
    expect(() => parseImport('{"features":{"radius_mean":1,"texture_mean":2},"sample_id":42}', schema)).toThrow();
  });
});
