import { expect, test } from "@playwright/test";

test("brand mark keeps its accessible home link and adapts to both themes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const brand = page.locator("header").getByRole("link", { name: "VeriPoC home" });
  await expect(brand).toBeVisible();
  await expect(brand.locator("svg")).toHaveAttribute("aria-hidden", "true");
  const box = await brand.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Paper" }).click();
  await expect.poll(() => page.locator("body").evaluate(body => getComputedStyle(body).backgroundColor)).toBe("rgb(246, 245, 242)");
  const lightStroke = await brand.locator("path").first().evaluate(path => getComputedStyle(path).stroke);
  await page.screenshot({ path: testInfo.outputPath("brand-light-1440.png"), fullPage: false });
  await page.getByRole("button", { name: "Charcoal" }).click();
  await expect.poll(() => page.locator("body").evaluate(body => getComputedStyle(body).backgroundColor)).toBe("rgb(20, 20, 20)");
  const darkStroke = await brand.locator("path").first().evaluate(path => getComputedStyle(path).stroke);
  expect(lightStroke).not.toBe(darkStroke);
  await page.screenshot({ path: testInfo.outputPath("brand-dark-1440.png"), fullPage: false });
  await brand.focus();
  await expect(brand).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath("brand-dark-390.png"), fullPage: false });
  const favicon = await page.request.get("/brand/veripoc-app-icon.svg");
  expect(favicon.ok()).toBe(true);
  expect(await favicon.text()).toContain("#ee9077");
});

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

test("authorized workspace requires a token and fits mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/programs/demo-vault");
  await expect(page.getByRole("heading", { name: "Demo Vault Audit Program" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open authorized program" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByLabel("Local program token").fill("invalid-token");
  await page.getByRole("button", { name: "Open authorized program" }).click();
  await expect(page.getByRole("status")).toContainText("verification API is unavailable");
  await expect(page.getByText("Private submissions")).toHaveCount(0);
});

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
  await page.getByRole("link", { name: "Enter authorized program" }).click();
  await expect(page).toHaveURL(/\/programs\/demo-vault$/);
  await expect(page.getByLabel("Local program token")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open authorized program" })).toBeDisabled();
  await page.goto("/submit-report");
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
  await expect(page.locator(".directory-bounty img.directory-project-logo")).toHaveCount(8);
  await expect(page.locator(".directory-source img.directory-project-logo")).toHaveCount(10);
  const firstBountyLogo = page.locator(".directory-bounty img.directory-project-logo").first();
  await firstBountyLogo.scrollIntoViewIfNeeded();
  await expect.poll(() => firstBountyLogo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const firstSourceLogo = page.locator(".directory-source img.directory-project-logo").first();
  await firstSourceLogo.scrollIntoViewIfNeeded();
  await expect.poll(() => firstSourceLogo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
  const soladyLogo = page.locator(".directory-source").filter({ hasText: "Solady" }).locator("img.directory-project-logo");
  await soladyLogo.scrollIntoViewIfNeeded();
  await expect.poll(() => soladyLogo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
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
  await expect(page.locator(".opportunity-project-logo")).toHaveAttribute("src", /raydium\.png/);
  const join = page.getByRole("link", { name: "Join bounty" });
  await expect(join).toHaveAttribute("href", "/submit-report?bounty=raydium");
  await expect(page.getByText(/External bug bounty/)).toHaveCount(0);
  const bountyTabs = page.getByRole("tablist", { name: "Bounty information" });
  await expect(bountyTabs.getByRole("tab", { name: "Instructions" })).toHaveAttribute("aria-selected", "true");
  await bountyTabs.getByRole("tab", { name: "Scope" }).click();
  await expect(page.getByRole("heading", { name: "Scope" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Read complete current scope/ })).toHaveAttribute("href", "https://immunefi.com/bug-bounty/raydium/scope/");
  await expect(page.getByRole("heading", { name: "Assets and systems to inspect" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Impact categories" })).toBeVisible();
  await bountyTabs.getByRole("tab", { name: "Scope" }).press("ArrowRight");
  await expect(bountyTabs.getByRole("tab", { name: "Prior audits" })).toHaveAttribute("aria-selected", "true");
  await expect(bountyTabs.getByRole("tab", { name: "Use your agent" })).toHaveCount(0);
  await join.click();
  await expect(page).toHaveURL(/\/submit-report\?bounty=raydium$/);
  await expect(page.getByRole("heading", { name: "Turn a finding into a report." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Verify PoC/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Raydium scope" }).click();
  await expect(page).toHaveURL(/\/opportunities\/raydium$/);
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

test("external report draft stays local and never starts a verifier job", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", request => { if (request.method() === "POST") posts.push(request.url()); });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (value: string) => { sessionStorage.setItem("external-report-draft", value); },
    } });
  });
  await page.goto("/submit-report?bounty=orca");
  await expect(page.getByRole("navigation", { name: "Finding preparation steps" }).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("heading", { name: "Targets" })).toBeVisible();
  await expect(page.getByText("Orca Whirlpools", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Read complete current scope/ })).toHaveAttribute("href", "https://immunefi.com/bug-bounty/orca/scope/");
  await page.getByRole("button", { name: "Continue to agent brief" }).click();
  await expect(page.getByRole("heading", { name: "Give your agent a bounded brief." })).toBeFocused();
  await page.getByRole("button", { name: "Draft a finding" }).click();
  await page.getByLabel("Finding title").fill("Candidate accounting issue");
  await page.getByLabel("Affected asset and revision").fill("Official Orca scoped asset at reviewed revision");
  await page.getByLabel("Impact and broken invariant").fill("Candidate impact requiring local reproduction");
  await page.getByLabel("Reproduction steps and PoC").fill("Local test steps and observations");
  await page.getByRole("button", { name: "Review finding" }).click();
  await expect(page.getByRole("heading", { name: "Review before submission." })).toBeFocused();
  await page.getByRole("button", { name: "Copy report" }).click();
  await expect(page.getByRole("status")).toContainText("Draft copied");
  const copied = await page.evaluate(() => sessionStorage.getItem("external-report-draft"));
  expect(copied).toContain("https://immunefi.com/bug-bounty/orca/scope/");
  expect(copied).toContain("Candidate accounting issue");
  await expect(page.getByRole("link", { name: "Continue on Immunefi" })).toHaveAttribute("href", "https://immunefi.com/bug-bounty/orca/information/");
  expect(posts).toEqual([]);
});

test("unknown bounty query cannot fall through to the vault verifier", async ({ page }) => {
  await page.goto("/submit-report?bounty=unknown-program");
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Verify PoC/ })).toHaveCount(0);
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
    await page.goto("/submit-report?bounty=orca");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("public scope remains readable without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/opportunities/demo-vault");
    await expect(page.getByRole("heading", { name: "What we’re looking for" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Enter authorized program" })).toBeVisible();
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
