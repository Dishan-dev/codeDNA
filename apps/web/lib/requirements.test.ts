import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoBundle } from '@codedna/shared';
import { edgeCaseFor, scanQuality } from './quality';
import { keywords, matchRequirements, parseRequirements } from './requirements';

const bundle = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'starters', 'snackshop.json'), 'utf8')) as RepoBundle;

const SRS = `# Snackshop — requirements

## Ordering
FR-1 The customer shall be able to place an order from the checkout page.
FR-2 The customer can apply a coupon code to get a discount.
FR-3 Customers must be able to save snacks to their favourites.

## Back office
- Admins can export orders as a report.
- The system shall send a confirmation email after each order.
2.1 Users shall reset their password by email.

Some intro text that is not a requirement.`;

describe('requirements coverage', () => {
  it('reads requirements from numbered items, bullets and "shall" sentences, under their headings', () => {
    const items = parseRequirements(SRS);
    expect(items.map((item) => item.id)).toEqual(['FR-1', 'FR-2', 'FR-3', 'R4', 'R5', 'R2.1']);
    expect(items[0]).toMatchObject({
      group: 'Ordering',
      text: 'The customer shall be able to place an order from the checkout page.',
    });
    expect(items[3]!.group).toBe('Back office');
  });

  it('lines up words in requirements and code, with synonyms', () => {
    expect(keywords('Users can sign in and delete favourites')).toEqual(['signin', 'delete', 'favorite']);
    expect(keywords('toggleFavorites removeProduct')).toEqual(['toggle', 'favorite', 'delete', 'product']);
  });

  it('marks what the code builds, what it partly builds and what is missing', () => {
    const coverage = matchRequirements(parseRequirements(SRS), bundle.features);
    const status = Object.fromEntries(coverage.matches.map((match) => [match.requirement.id, match.status]));
    expect(status['FR-1']).toBe('built');
    expect(status['FR-2']).toBe('built');
    expect(status['FR-3']).toBe('built');
    expect(status['R2.1']).toBe('missing');
    const order = coverage.matches.find((match) => match.requirement.id === 'FR-1')!;
    expect(order.features[0]!.feature.title).toBe('Place order');
    expect(order.features[0]!.words).toContain('order');
    expect(coverage.percent).toBeGreaterThan(40);
    expect(coverage.percent).toBeLessThan(100);
  });
});

describe('quality scan', () => {
  it('turns real conditions into edge cases a tester can follow', () => {
    expect(edgeCaseFor('!formData.email.trim()')).toBe('Leave email empty');
    expect(edgeCaseFor('!emailRegex.test(formData.email.trim())')).toBe('Enter a badly formatted email');
    expect(edgeCaseFor('formData.firstName.trim().length < 3')).toBe('Enter fewer than 3 characters in first name');
    expect(edgeCaseFor('beneficiary.trim().length > 150')).toBe('Enter more than 150 characters in beneficiary');
    expect(edgeCaseFor('Number.isNaN(parsedAmount)')).toBe('Type letters instead of a number in parsed amount');
    expect(edgeCaseFor('parsedAmount <= 0')).toBe('Enter 0 or a negative parsed amount');
    expect(edgeCaseFor('status === 401')).toMatch(/session expire/);
    expect(edgeCaseFor('!session')).toBe('Try it while signed out');
    expect(edgeCaseFor('isSubmittingTransfer')).toBe('Click the button twice, quickly');
    // Anything unclear is left out, not guessed.
    expect(edgeCaseFor('Object.keys(nextErrors).length > 0')).toBeUndefined();
  });

  it('finds the risky spots in a real app, most serious first', () => {
    const report = scanQuality(bundle);
    expect(report.scanned).toBe(bundle.features.filter((feature) => feature.entryKind !== 'link').length);
    expect(report.findings[0]!.severity).toBe('high');
    expect(report.findings.some((finding) => finding.kind === 'missing-auth-check' && /Save to favorites/.test(finding.title))).toBe(true);
    for (const finding of report.findings) expect(finding.where ?? '').toMatch(/:\d+$/);
  });
});
