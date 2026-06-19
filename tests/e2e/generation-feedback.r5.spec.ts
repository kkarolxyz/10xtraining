// Risk: R5 — context/foundation/test-plan.md
// Seed: seed.spec.ts
import { test, expect } from "@playwright/test";

const VALID_RIDE_STATS = [
  "Date: 2024-04-01, Distance: 42km, Avg speed: 28.5 km/h, Duration: 88min, Elevation: 520m",
  "Date: 2024-04-03, Distance: 25km, Avg speed: 26.1 km/h, Duration: 57min, Elevation: 210m",
  "Date: 2024-04-06, Distance: 60km, Avg speed: 27.8 km/h, Duration: 130min, Elevation: 680m",
  "Date: 2024-04-08, Distance: 35km, Avg speed: 29.2 km/h, Duration: 72min, Elevation: 310m",
  "Date: 2024-04-10, Distance: 50km, Avg speed: 28.0 km/h, Duration: 107min, Elevation: 450m",
].join("\n");

test.describe("R5 — generation feedback and latency", () => {
  test.skip(!process.env.E2E_TEST_EMAIL, "E2E credentials not set — set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");

  test("shows loading state then plan within 30 s", async ({ page }) => {
    let planUrl: string | null = null;

    try {
      // Arrange: storageState already provides auth (via auth.setup.ts)
      await page.goto("/generate");
      // client:load hydration can race fill(); wait for idle network before touching inputs
      await page.waitForLoadState("networkidle");
      await page.getByRole("textbox").fill(VALID_RIDE_STATS);
      await page.getByRole("radio", { name: /speed/i }).evaluate((el) => {
        (el as HTMLInputElement).click();
      });
      await page.getByRole("button", { name: "Generate plan" }).click();

      // Assert: loading indicator is immediately visible — proves R5 (user sees feedback, not silence)
      await page.getByText(/generating your plan/i).isVisible();

      // Assert: plan heading is visible within 30 s — proves end-to-end latency NFR
      await page.waitForURL(/\/plans\/[0-9a-f-]+/, { timeout: 30_000 });
      planUrl = page.url();

      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    } finally {
      // Cleanup: delete the plan created by this test run
      if (planUrl) {
        await page.goto(planUrl);
        await page.getByRole("button", { name: "Delete" }).click();
        await page.waitForURL("/dashboard");
      }
    }
  });
});
