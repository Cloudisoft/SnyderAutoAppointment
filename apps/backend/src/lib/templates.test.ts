import { describe, expect, it } from 'vitest';
import { leadVars, normalizeTemplate, placeholdersIn, renderTemplate } from './templates';

describe('templates', () => {
  it('normalizes placeholder spellings', () => {
    expect(normalizeTemplate('{{ First Name }} {first_name} {{custom.Plan-Tier}} {{agentName}}')).toBe(
      '{{first_name}} {{first_name}} {{plan_tier}} {{agent_name}}',
    );
  });

  it('fills known placeholders and strips unknown ones', () => {
    const out = renderTemplate('Hi {{first_name}} {{nickname}}, this is {agent_name}.', {
      first_name: 'Ada',
      agent_name: 'Katie',
    });
    expect(out).toBe('Hi Ada, this is Katie.');
    expect(out).not.toMatch(/[{}]/);
  });

  it('tidies spacing when a value is missing', () => {
    expect(renderTemplate('Hi {{first_name}}, welcome', {})).toBe('Hi, welcome');
  });

  it('escapes values in HTML mode except trusted keys', () => {
    const out = renderTemplate('<p>{{first_name}}</p>{{link}}', { first_name: '<b>x</b>', link: '<a href="#">go</a>' }, {
      html: true,
      rawHtmlKeys: ['link'],
    });
    expect(out).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p><a href="#">go</a>');
  });

  it('exposes lead custom fields as placeholders', () => {
    const vars = leadVars({ first_name: 'Ada', custom_fields: { 'Plan Tier': 'gold', nested: { a: 1 } } });
    expect(renderTemplate('{{plan_tier}}|{{nested}}', vars)).toBe('gold|');
  });

  it('lists placeholders', () => {
    expect(placeholdersIn('{first name} and {{ time_zone }}').sort()).toEqual(['first_name', 'time_zone']);
  });

  it('leaves code-like braces alone', () => {
    expect(normalizeTemplate('a {{b}} {"json": 1}')).toBe('a {{b}} {"json": 1}');
  });
});
