import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, toCsv } from './csv';

describe('csv', () => {
  it('parses quoted fields, escaped quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
  it('maps headers to normalized keys', () => {
    expect(parseCsvObjects('First Name,Phone #\nAnn,555')).toEqual([{ first_name: 'Ann', phone: '555' }]);
  });
  it('escapes output and neutralizes formulas', () => {
    expect(toCsv(['a'], [['=1+1'], ['x,y']])).toBe("a\r\n'=1+1\r\n\"x,y\"\r\n");
  });
});
