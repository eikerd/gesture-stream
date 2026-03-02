import { test, expect } from '@playwright/test';

// 1. Page loads — has expected heading/title, no uncaught JS errors
test('page loads with expected heading and no uncaught JS errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Check the brand heading is visible
  const heading = page.locator('text=pose.stream').first();
  await expect(heading).toBeVisible();

  // Verify no uncaught JS errors
  expect(errors).toHaveLength(0);
});

// 2. Canvas element present and has non-zero dimensions
test('canvas element is present and has non-zero dimensions', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
});

// 3. Mock mode on by default — Switch shows checked state
test('mock mode is on by default and switch is checked', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // The switch for mock mode should exist
  const mockSwitch = page.locator('#mock-toggle');
  await expect(mockSwitch).toBeVisible();

  // The switch should be in the "on" (checked) state by default
  // Radix Switch sets aria-checked="true" when on
  await expect(mockSwitch).toHaveAttribute('aria-checked', 'true');
});

// 4. Stream inspector panel visible — status badge, FPS/latency stats present
test('stream inspector panel is visible with status badge and FPS/latency stats', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Status badge — in mock mode it should show "Connected"
  const badge = page.locator('text=Connected').first();
  await expect(badge).toBeVisible();

  // FPS label
  const fpsLabel = page.locator('text=FPS').first();
  await expect(fpsLabel).toBeVisible();

  // Latency label
  const latencyLabel = page.locator('text=Latency').first();
  await expect(latencyLabel).toBeVisible();
});

// 5. Mock toggle — click Switch to turn off, click again to turn on; canvas still present
test('mock toggle can be turned off and on; canvas remains present', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const mockSwitch = page.locator('#mock-toggle');

  // Turn mock mode OFF
  await mockSwitch.click();
  await expect(mockSwitch).toHaveAttribute('aria-checked', 'false');

  // Canvas is still present
  await expect(page.locator('canvas').first()).toBeVisible();

  // Turn mock mode back ON
  await mockSwitch.click();
  await expect(mockSwitch).toHaveAttribute('aria-checked', 'true');

  // Canvas is still present
  await expect(page.locator('canvas').first()).toBeVisible();
});

// 6. WS host input — input field present, can type a new hostname (only visible when mock is off)
test('WS host input is present and accepts input when mock mode is off', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Turn off mock mode to reveal the host input
  const mockSwitch = page.locator('#mock-toggle');
  await mockSwitch.click();
  await expect(mockSwitch).toHaveAttribute('aria-checked', 'false');

  // Input field should now be visible
  const wsInput = page.locator('input[placeholder="pi-zero-ai.local"]');
  await expect(wsInput).toBeVisible();

  // Clear and type a new hostname
  await wsInput.fill('my-pi.local');
  await expect(wsInput).toHaveValue('my-pi.local');
});

// 7. Sessions page — navigate to /sessions, table element or empty-state present
test('sessions page loads and shows a table or empty state', async ({ page }) => {
  await page.goto('/sessions');
  await page.waitForLoadState('networkidle');

  // The page heading should be visible
  const heading = page.locator('text=Past Sessions').first();
  await expect(heading).toBeVisible();

  // Either a table is present OR the empty-state message is present
  const table = page.locator('table');
  const emptyState = page.locator('text=No sessions recorded yet.');

  const tableCount = await table.count();
  const emptyCount = await emptyState.count();

  expect(tableCount + emptyCount).toBeGreaterThan(0);
});

// 8. API POST /api/sessions — fetch POST returns 201 + json with id
test('POST /api/sessions returns 201 with a session id', async ({ page }) => {
  await page.goto('/');

  const response = await page.evaluate(async () => {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', exercise: 'squat' }),
    });
    const json = await res.json();
    return { status: res.status, json };
  });

  expect(response.status).toBe(201);
  expect(response.json).toHaveProperty('id');
});

// 9. API GET /api/sessions — fetch GET returns 200 + array
test('GET /api/sessions returns 200 with an array', async ({ page }) => {
  await page.goto('/');

  const response = await page.evaluate(async () => {
    const res = await fetch('/api/sessions');
    const json = await res.json();
    return { status: res.status, isArray: Array.isArray(json) };
  });

  expect(response.status).toBe(200);
  expect(response.isArray).toBe(true);
});
