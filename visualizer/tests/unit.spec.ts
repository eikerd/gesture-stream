// Logic tests: no page fixture, so they run without the dev server the browser
// specs in this directory expect.
import { test, expect } from '@playwright/test';
import { consume, resetRateLimits, clientKey } from '../lib/rateLimit';
import { SquatCounter } from '../lib/repCounter';
import { type PoseFrame } from '../lib/pose';

test.describe('coach endpoint rate limit', () => {
  test.beforeEach(() => resetRateLimits());

  test('lets a caller through up to the per-minute cap, then holds them', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) {
      expect(consume('1.2.3.4', 20, 500, now).ok, `call ${i + 1} of 20`).toBe(true);
    }
    const blocked = consume('1.2.3.4', 20, 500, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.scope).toBe('minute');
  });

  test('one caller hitting the cap does not block another', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) consume('1.2.3.4', 20, 500, now);
    expect(consume('5.6.7.8', 20, 500, now).ok).toBe(true);
  });

  test('the window reopens once the minute has passed', () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) consume('1.2.3.4', 20, 500, now);
    expect(consume('1.2.3.4', 20, 500, now).ok).toBe(false);
    expect(consume('1.2.3.4', 20, 500, now + 60_001).ok).toBe(true);
  });

  test('a rejected call does not spend the daily allowance', () => {
    const now = Date.now();
    // Fill the minute, get refused twice, then let the minute roll over.
    for (let i = 0; i < 3; i++) consume('9.9.9.9', 3, 10, now);
    consume('9.9.9.9', 3, 10, now);
    consume('9.9.9.9', 3, 10, now);
    // Seven of the ten daily calls must remain: only the three that succeeded count.
    for (let i = 0; i < 7; i++) {
      expect(consume('9.9.9.9', 3, 10, now + 60_001 + i * 60_001).ok, `daily call ${i + 4}`).toBe(true);
    }
    expect(consume('9.9.9.9', 3, 10, now + 60_001 * 9).ok).toBe(false);
  });

  test('reads the first address out of a proxy chain', () => {
    expect(clientKey(new Headers({ 'x-forwarded-for': '203.0.113.9, 70.41.3.18' }))).toBe('203.0.113.9');
    expect(clientKey(new Headers({ 'x-real-ip': '203.0.113.7' }))).toBe('203.0.113.7');
    expect(clientKey(new Headers())).toBe('unknown');
  });
});

test.describe('rep counting with unreliable keypoints', () => {
  const frame = (points: Array<{ name: string; x: number; y: number; score: number }>): PoseFrame =>
    ({ keypoints: points } as unknown as PoseFrame);

  // A squat: hip-knee-ankle nearly straight is "up", sharply bent is "down".
  // Deliberately off the vertical: with the joints collinear, substituting the
  // frame's centre for the knee gives 180 degrees too, and the test could not
  // tell the old behaviour from the new one.
  const standing = [
    { name: 'left_hip', x: 0.45, y: 0.35, score: 0.9 },
    { name: 'left_knee', x: 0.47, y: 0.62, score: 0.9 },
    { name: 'left_ankle', x: 0.5, y: 0.85, score: 0.9 },
  ];
  const squatting = [
    { name: 'left_hip', x: 0.5, y: 0.55, score: 0.9 },
    { name: 'left_knee', x: 0.62, y: 0.6, score: 0.9 },
    { name: 'left_ankle', x: 0.5, y: 0.8, score: 0.9 },
  ];

  test('a frame missing a joint is skipped, not guessed at', () => {
    const counter = new SquatCounter();
    counter.update(frame(standing));
    const before = counter.getAngle();
    // The knee drops out entirely: the old code substituted the frame's centre,
    // which invented an angle and could trip a phase change.
    expect(counter.update(frame(standing.filter((k) => k.name !== 'left_knee')))).toBeNull();
    expect(counter.getAngle()).toBe(before);
  });

  test('a low-confidence joint is treated as missing', () => {
    const counter = new SquatCounter();
    counter.update(frame(standing));
    const before = counter.getAngle();
    const unsure = standing.map((k) => (k.name === 'left_knee' ? { ...k, score: 0.1 } : k));
    expect(counter.update(frame(unsure))).toBeNull();
    expect(counter.getAngle()).toBe(before);
  });

  test('a clean down-and-up still counts one rep', () => {
    const counter = new SquatCounter();
    counter.update(frame(standing));
    counter.update(frame(squatting));
    const event = counter.update(frame(standing));
    expect(event).not.toBeNull();
    expect(counter.getCount()).toBe(1);
  });
});
