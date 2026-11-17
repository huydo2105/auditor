import { expect, test } from "@playwright/test";

for (const width of [1440, 1024, 390, 320]) {
  test(`workflow, leaderboard, and vault detail fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.locator(".story-section")).toHaveCount(3);
    await expect(page.getByText("Payouts available")).toBeVisible();
    await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Leaderboard" }).click();
    await expect(page).toHaveURL(/\/leaderboard$/);
    await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
    await expect(page.getByText("AGENT DIRECTORY PREVIEW")).toBeVisible();
    await expect(page.locator(".agent-board tbody tr")).toHaveCount(3);
    await page.getByRole("searchbox", { name: "Search AI agents" }).fill("vault");
    await expect(page.locator(".agent-board tbody tr")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.goto("/opportunities/demo-vault");
    await expect(page.getByRole("heading", { name: "Vault Audit Program" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.goto("/submit-report");
    await expect(page.getByRole("heading", { name: /Turn an agent finding.*into evidence/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole("button", { name: "Continue to agent brief" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("opportunity tabs show reviewed instructions and scope", async ({ page }) => {
  await page.goto("/opportunities/demo-vault");
  const tabs = page.getByRole("tablist", { name: "Program information" });
  await expect(tabs.getByRole("tab", { name: "Instructions" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "What we’re looking for" })).toBeVisible();
  await page.getByRole("link", { name: /Read the researcher workflow/ }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await page.goBack();
  await tabs.getByRole("tab", { name: "Scope" }).click();
  await expect(page.getByRole("heading", { name: "In scope" })).toBeVisible();
  await expect(page.getByText("contracts/evm/FixtureVault.sol")).toBeVisible();
  await expect(page.getByText("Deployed contracts", { exact: true })).toBeVisible();
});

test("reviewed vault opens only the supported local report flow", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { sessionStorage.setItem("copied-agent-brief", value); },
    } });
  });
  await page.goto("/opportunities/demo-vault");
  await expect(page.getByText("None offered")).toBeVisible();
  await page.getByRole("link", { name: /Open verification workspace/ }).click();
  await expect(page).toHaveURL(/\/submit-report$/);
  await expect(page.getByRole("heading", { name: /Turn an agent finding.*into evidence/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Finding preparation steps" }).getByRole("button")).toHaveCount(4);
  await page.getByRole("button", { name: "Continue to agent brief" }).click();
  await expect(page.getByRole("heading", { name: "Give your agent a bounded brief." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Give your agent a bounded brief." })).toBeFocused();
  await page.getByRole("button", { name: "Copy brief" }).click();
  await expect(page.getByRole("status")).toContainText("Agent brief copied");
  expect(await page.evaluate(() => sessionStorage.getItem("copied-agent-brief"))).toContain("contracts/evm/FixtureVault.sol");
  await page.getByRole("button", { name: "Draft a finding" }).click();
  await page.getByRole("button", { name: "Review and verify" }).click();
  await expect(page.locator(".report-field-error")).toContainText("Complete the required finding fields");
  await expect(page.getByLabel("Claim title")).toBeFocused();
  await page.getByRole("button", { name: "Skip draft" }).click();
  await expect(page.getByRole("button", { name: /Verify PoC/ })).toBeVisible();
  await expect(page.locator("#verification").getByText("Awaiting run", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Verify PoC/ }).click();
  await expect(page.locator("#verification").getByRole("alert")).toContainText("Enter the local API token");
  await page.getByLabel("LOCAL API TOKEN").fill("invalid-test-token");
  await page.getByRole("button", { name: /Verify PoC/ }).click();
  await expect(page.locator("#verification").getByRole("alert")).toContainText(/verification API is unavailable|API token rejected/i, { timeout: 20000 });
  await expect(page.locator("#verification").getByText("Awaiting run", { exact: true })).toBeVisible();
});

test("researcher draft is local, reviewable, and cleared on reload", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto("/submit-report");
  await page.getByRole("button", { name: "Continue to agent brief" }).click();
  await page.getByRole("button", { name: "Draft a finding" }).click();
  for (const [label, value] of [
    ["Claim title", "Share inflation"], ["Affected code location", "FixtureVault.sol:deposit"],
    ["Root cause and preconditions", "Donation before victim deposit"], ["Observed or expected impact", "Victim receives no shares"],
    ["Security invariant", "Victim receives positive shares"], ["Reproduction steps and PoC reference", "Run reviewed vault oracle"],
  ]) await page.getByLabel(label).fill(value);
  await page.getByRole("button", { name: "Review and verify" }).click();
  await expect(page.getByText("Unsent finding draft")).toBeVisible();
  await expect(page.getByText("Share inflation", { exact: true })).toBeVisible();
  expect(posts).toEqual([]);
  await page.getByRole("button", { name: "Edit draft" }).click();
  await expect(page.getByLabel("Claim title")).toHaveValue("Share inflation");
  await page.reload();
  await page.getByRole("button", { name: "Continue to agent brief" }).click();
  await page.getByRole("button", { name: "Draft a finding" }).click();
  await expect(page.getByLabel("Claim title")).toHaveValue("");
});

test("agent brief stays readable when clipboard permission is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async () => { throw new Error("clipboard denied"); },
    } });
  });
  await page.goto("/submit-report");
  await page.getByRole("button", { name: "Continue to agent brief" }).click();
  await page.getByRole("button", { name: "Copy brief" }).click();
  await expect(page.getByRole("status")).toContainText("Select and copy the brief below");
  await expect(page.locator(".report-agent-brief")).toContainText("contracts/evm/FixtureVault.sol");
});

test("directory shows real external bounties and one separate runnable fixture", async ({ page }) => {
  await page.goto("/get-started");
  await expect(page.locator(".directory-row")).toHaveCount(19);
  await expect(page.locator(".directory-bounty")).toHaveCount(8);
  await expect(page.locator(".directory-source")).toHaveCount(10);
  await expect(page.getByText("Showing 19 entries")).toBeVisible();
  await expect(page.locator(".directory-source").first()).toBeVisible();
  await expect(page.getByText(/External programs are hosted by their owners on Immunefi/)).toBeVisible();
  const uniswap = page.getByRole("link", { name: /Open official source for Uniswap v4 Core/ });
  await expect(uniswap).toHaveAttribute("href", /^https:\/\/github\.com\/Uniswap\/v4-core\/tree\/[a-f0-9]{40}$/);
  await expect(uniswap).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByRole("group", { name: "Filter by ecosystem" })).toHaveCount(0);
  await page.getByRole("group", { name: "Opportunity category" }).getByRole("button", { name: /Bug bounties/ }).click();
  await expect(page.locator(".directory-bounty")).toHaveCount(8);
  await expect(page.locator(".directory-source")).toHaveCount(0);
  await expect(page.locator(".directory-bounty").filter({ hasText: "Solana" })).not.toHaveCount(0);
  await page.getByRole("link", { name: "View Raydium bounty summary" }).click();
  await expect(page).toHaveURL(/\/opportunities\/raydium$/);
  const join = page.getByRole("link", { name: /Join Raydium bounty on Immunefi/ });
  await expect(join).toHaveAttribute("href", "https://immunefi.com/bug-bounty/raydium/information/");
  await expect(join).toHaveAttribute("rel", "noopener noreferrer");
  const bountyTabs = page.getByRole("tablist", { name: "Bounty information" });
  await expect(bountyTabs.getByRole("tab", { name: "Instructions" })).toHaveAttribute("aria-selected", "true");
  await bountyTabs.getByRole("tab", { name: "Scope" }).click();
  await expect(page.getByRole("heading", { name: "Scope" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Inspect current scope/ })).toHaveAttribute("href", "https://immunefi.com/bug-bounty/raydium/scope/");
  await bountyTabs.getByRole("tab", { name: "Scope" }).press("ArrowRight");
  await expect(bountyTabs.getByRole("tab", { name: "Prior audits" })).toHaveAttribute("aria-selected", "true");
  await bountyTabs.getByRole("tab", { name: "Use your agent" }).click();
  await expect(page.getByRole("heading", { name: "Investigate with your own AI agent" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy agent brief" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open verification workspace/ })).toHaveCount(0);
  await page.getByRole("link", { name: "All opportunities" }).click();
  await page.getByRole("group", { name: "Opportunity category" }).getByRole("button", { name: /Public source/ }).click();
  await expect(page.locator(".directory-source")).toHaveCount(8);
  await expect(page.getByRole("link", { name: "Open Demo Vault Audit Program details" })).toHaveCount(0);
  await page.getByRole("group", { name: "Opportunity category" }).getByRole("button", { name: /Practice labs/ }).click();
  await expect(page.locator(".directory-source")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search opportunities" }).fill("Ethernaut");
  await expect(page.locator(".directory-source")).toHaveCount(1);
  await page.getByRole("searchbox", { name: "Search opportunities" }).fill("no such repository");
  await expect(page.getByRole("status")).toContainText("No matching entries");
  await page.getByRole("searchbox", { name: "Search opportunities" }).clear();
  await page.getByRole("group", { name: "Opportunity category" }).getByRole("button", { name: /All/ }).click();
  await page.getByRole("link", { name: "Open Demo Vault Audit Program details" }).click();
  await expect(page).toHaveURL(/\/opportunities\/demo-vault$/);
});

test("external bounty brief copies public rules without starting a verifier job", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { sessionStorage.setItem("external-agent-brief", value); },
    } });
  });
  await page.goto("/opportunities/orca");
  await page.getByRole("tab", { name: "Use your agent" }).click();
  await page.getByRole("button", { name: "Copy agent brief" }).click();
  await expect(page.getByRole("status")).toContainText("Research brief copied");
  const copied = await page.evaluate(() => sessionStorage.getItem("external-agent-brief"));
  expect(copied).toContain("https://immunefi.com/bug-bounty/orca/scope/");
  expect(copied).toContain("The researcher submits through the official Immunefi program");
  expect(posts).toEqual([]);
});

for (const width of [1440, 1024, 390, 320]) {
  test(`public source directory fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/get-started");
  await expect(page.locator(".directory-source")).toHaveCount(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.getByRole("group", { name: "Opportunity category" }).getByRole("button", { name: /Practice labs/ }).focus();
    await expect(page.getByRole("group", { name: "Opportunity category" }).getByRole("button", { name: /Practice labs/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".directory-source")).toHaveCount(2);
  });
}

test("public scope remains readable without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/opportunities/demo-vault");
    await expect(page.getByRole("heading", { name: "What we’re looking for" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open verification workspace/ })).toBeVisible();
  } finally { await context.close(); }
});

test("team draft wizard keeps fields locally and never submits a program", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.goto("/teams/new");
  await expect(page.getByRole("heading", { name: "Draft a bug bounty project" })).toBeVisible();
  await expect(page.getByText("Team workspace preview")).toHaveCount(0);
  await page.getByRole("textbox", { name: /Project name/ }).fill("Sample vault review");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByRole("complementary", { name: "Program draft preview" })).toContainText("Sample vault review");
  await page.getByRole("button", { name: "Help for System overview and investigation goals" }).focus();
  await expect(page.getByRole("tooltip")).toContainText("Describe assets, trust boundaries");
  await page.getByRole("textbox", { name: /System overview and investigation goals/ }).fill("Review share accounting and record a PoC.");
  await page.getByRole("navigation", { name: "Draft sections" }).getByRole("button", { name: /Scope/ }).click();
  await page.getByRole("textbox", { name: /Target contract and immutable revision/ }).fill("Vault.sol at commit abc123");
  await page.getByRole("textbox", { name: /Permitted testing scope/ }).fill("Local fixture only");
  await page.getByRole("navigation", { name: "Draft sections" }).getByRole("button", { name: /Links/ }).click();
  await page.getByRole("button", { name: /Preview unsaved draft/ }).click();
  await expect(page.getByRole("complementary", { name: "Program draft preview" })).toContainText("Sample vault review");
  expect(posts).toEqual([]);
  await page.reload();
  await expect(page.getByRole("complementary", { name: "Program draft preview" })).not.toContainText("Sample vault review");
});
