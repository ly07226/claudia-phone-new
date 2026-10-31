import { test, expect, type Page } from "@playwright/test";
const syntheticKey = "synthetic-selection-fixture";
async function open(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "AI / API 设置", exact: true }).click();
}
async function create(page: Page, name: string, model = "model-for-testing") {
  await page.getByRole("button", { name: "＋ 添加 API 配置", exact: true }).click();
  await page.getByLabel("配置名称", { exact: true }).fill(name);
  await page.getByLabel("Base URL", { exact: true }).fill("https://selection.example.test/v1");
  await page.getByLabel("API Key", { exact: true }).fill(syntheticKey);
  await page.getByLabel("Model", { exact: true }).fill(model);
  await page.getByRole("button", { name: "保存 API 配置", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.evaluate(async name => (await (await import("/src/store.ts")).db.apiConfigs.toArray()).find(c => c.name === name)!.id, name);
}
const card = (page: Page, id: string) => page.locator(`[data-api-id="${id}"]`);

async function defaultIs(page: Page, id: string) {
  await expect.poll(() => page.evaluate(async () => (await (await import("/src/store.ts")).db.apiConfigs.toArray()).filter(c => c.isDefault).map(c => c.id))).toEqual([id]);
}
test("唯一配置自动默认、新角色继承、多配置保留默认、切换刷新、停用删除回退与清空引导", async ({ page }) => {
  await open(page);
  const first = await create(page, "第一连接");
  await defaultIs(page, first);
  const inherited = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts"); const { getConversation, resolveApi } = await import("/src/chatService.ts");
    await db.characters.add({ id: "new-role", name: "新角色", persona: "" });
    const conv = await getConversation("new-role"); return (await resolveApi(conv)).config.id;
  });
  expect(inherited).toBe(first);
  const second = await create(page, "第二连接");
  await defaultIs(page, first);
  await card(page, second).click();
  await page.getByLabel("设为默认配置", { exact: true }).check();
  await page.getByRole("button", { name: "保存 API 配置", exact: true }).click();
  await expect(page.locator(".api-settings form")).toHaveCount(0);
  await defaultIs(page, second);
  await open(page); await defaultIs(page, second);
  const third = await create(page, "第三连接");
  // Valid explicit bindings must remain untouched by default changes.
  await page.evaluate(async id => { const { db } = await import("/src/store.ts"); await db.characters.update("new-role", { apiConfigId: id }); }, third);
  await card(page, second).click();
  await page.getByLabel("启用配置", { exact: true }).uncheck();
  await page.getByRole("button", { name: "保存 API 配置", exact: true }).click();
  await defaultIs(page, first);
  await card(page, first).click();
  await expect(page.locator(".api-default-notice")).toContainText("按创建时间");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  page.on("dialog", dialog => void dialog.accept());
  await card(page, first).click();
  await page.getByRole("button", { name: "删除配置", exact: true }).click();
  await defaultIs(page, third);
  expect(await page.evaluate(async () => (await (await import("/src/store.ts")).db.characters.get("new-role"))?.apiConfigId)).toBe(third);
  for (const id of [second, third]) {
    await card(page, id).click();
    await page.getByRole("button", { name: "删除配置", exact: true }).click();
  }
  await expect(page.locator(".api-config-card")).toHaveCount(0);
  await expect(page.locator(".empty")).toContainText("尚未配置 API");
  expect(await page.evaluate(async () => (await import("/src/store.ts")).db.apiCredentials.count())).toBe(0);
});

test("旧配置缺默认可修复、字段完整不等于验证、无密钥/协议不支持不可默认，明确无效绑定报错", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts"); const { reconcileApiDefault } = await import("/src/apiSelection.ts");
    const { getConversation, resolveApi } = await import("/src/chatService.ts");
    const base = { name: "旧配置", provider: "openai-compatible", baseUrl: "https://selection.example.test/v1", model: "old-model", temperature: 0.4, maxTokens: 400, enabled: true, isDefault: false, createdAt: 1, updatedAt: 1 };
    await db.apiConfigs.bulkPut([{ ...base, id: "b" }, { ...base, id: "a" }, { ...base, id: "no-key", isDefault: true }, { ...base, id: "unsupported", provider: "custom" }]);
    await db.apiCredentials.bulkPut(["a", "b", "unsupported"].map(configId => ({ configId, apiKey: "synthetic-selection-fixture" })));
    const chosen = await reconcileApiDefault(); const repeated = await reconcileApiDefault();
    await db.characters.add({ id: "explicit", name: "指定角色", persona: "", apiConfigId: "b" });
    const conv = await getConversation("explicit"); const explicit = (await resolveApi(conv)).config.id;
    await db.apiConfigs.update("b", { enabled: false }); let failed = false;
    try { await resolveApi(conv); } catch { failed = true; }
    return { chosen: chosen.config?.id, available: chosen.availableIds, repeatChanged: repeated.changed, explicit, failed, defaults: (await db.apiConfigs.toArray()).filter(c => c.isDefault).map(c => c.id) };
  });
  expect(result).toEqual({ chosen: "a", available: ["a", "b"], repeatChanged: false, explicit: "b", failed: true, defaults: ["a"] });
  await open(page);
  await card(page, "a").click();
  await expect(page.getByLabel("Temperature", { exact: true })).toHaveValue("0.4");
  await expect(page.getByLabel("Max Tokens", { exact: true })).toHaveValue("400");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "取消", exact: true }).click();
});

for (const width of [375, 390, 430]) {
  test(`API 卡片与独立编辑界面 ${width}px，无明文泄露且错误可读`, async ({ page }) => {
    const logged: string[] = []; page.on("console", msg => logged.push(msg.text()));
    await page.setViewportSize({ width, height: 844 }); await open(page);
    const id = await create(page, "我的长名称 API 连接与备用供应商配置".repeat(3), "provider/" + "very-long-model-".repeat(12));
    await expect(page.locator(".api-settings form")).toHaveCount(0);
    await expect(card(page, id)).not.toContainText(syntheticKey);
    await expect(card(page, id)).not.toContainText("https://selection.example.test");
    await expect(card(page, id)).not.toContainText("连接成功");
    await expect(page.getByLabel("当前默认 API", { exact: true })).toHaveCount(0);
    await expect(card(page, id).getByRole("button")).toHaveCount(0);
    await expect(card(page, id)).not.toContainText("OpenAI Compatible");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `artifacts/api-cards-${width}.png` });
    await card(page, id).click();
    await expect(page.locator(".api-config-card")).toHaveCount(0);
    await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "显示 API Key", exact: true }).click();
    await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "隐藏 API Key", exact: true }).click();
    await page.route("https://selection.example.test/**", r => r.fulfill({ status: 401, json: { error: { message: syntheticKey } } }));
    await page.getByRole("button", { name: "测试连接（当前表单）", exact: true }).click();
    await expect(page.locator(".api-draft-result")).toContainText("认证失败");
    await expect(page.locator("body")).not.toContainText(syntheticKey);
    await page.getByLabel("API Key", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/api-editor-${width}.png` });
    await page.setViewportSize({ width, height: 460 });
    await page.getByRole("button", { name: "保存 API 配置", exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", { name: "保存 API 配置", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(logged.join("\n")).not.toContain(syntheticKey);
  });
}
