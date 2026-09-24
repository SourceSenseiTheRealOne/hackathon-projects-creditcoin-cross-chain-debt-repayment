import { expect, test } from "@playwright/test";

const repository =
  "https://github.com/SourceSenseiTheRealOne/hackathon-projects-creditcoin-cross-chain-debt-repayment";

test("footer links to the canonical repository", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "GitHub ↗", exact: true }),
  ).toHaveAttribute("href", repository);
});

test("verification instructions link to the canonical repository", async ({
  page,
}) => {
  await page.goto("/verify");
  await expect(
    page.getByRole("link", {
      name: "Source and verification instructions ↗",
      exact: true,
    }),
  ).toHaveAttribute("href", repository);
});
