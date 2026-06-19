import { test as setup } from "@playwright/test";

const E2E_EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";

setup("authenticate", async ({ page }) => {
  setup.skip(!E2E_EMAIL, "E2E credentials not set — set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");

  await page.goto("/auth/signin");
  await page.getByLabel("Email").fill(E2E_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("/dashboard");

  await page.context().storageState({ path: "playwright/.auth/user.json" });
});
