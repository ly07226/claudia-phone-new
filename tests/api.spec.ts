import { test, expect } from "@playwright/test";
async function openSettings(page: any) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "AI / API 设置", exact: true })
    .click();
}
async function create(page: any, name: string, provider = "openai-compatible") {
  await page
    .getByRole("button", { name: "＋ 添加 API 配置", exact: true })
    .click();
  await page.getByLabel("配置名称", { exact: true }).fill(name);
  await page.getByLabel("Provider", { exact: true }).selectOption(provider);
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://api.example.test/v1");
  await page
    .getByLabel("API Key", { exact: true })
    .fill("test-only-not-a-real-key");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByRole("button", { name: "显示 API Key" }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await page.getByLabel("Model", { exact: true }).fill("test-model");
  await page.getByRole("button", { name: "保存 API 配置" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test("API CRUD、默认唯一、启停、独立凭据及刷新保存", async ({ page }) => {
  await openSettings(page);
  await create(page, "连接一");
  await expect(page.getByRole("button", { name: "设为默认", exact: true })).toBeDisabled();
  await create(page, "连接二", "gemini");
  await page.locator(".api-config-card").filter({ has: page.getByRole("heading", { name: "连接二", exact: true }) }).getByRole("button", { name: "设为默认", exact: true }).click();
  const state = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return {
      configs: await db.apiConfigs.toArray(),
      keys: await db.apiCredentials.toArray(),
    };
  });
  expect(state.configs.filter((c: any) => c.isDefault)).toHaveLength(1);
  expect(state.configs.find((c: any) => c.isDefault).name).toBe("连接二");
  expect(state.keys).toHaveLength(2);
  expect(state.configs.some((c: any) => "apiKey" in c)).toBe(false);
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "AI / API 设置", exact: true })
    .click();
  await page
    .getByLabel("当前默认 API")
    .selectOption(state.configs.find((c: any) => c.name === "连接二").id);
  await page.locator(".api-config-card").filter({ has: page.getByRole("heading", { name: "连接二", exact: true }) }).getByRole("button", { name: "编辑配置", exact: true }).click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveAttribute(
    "type",
    "password",
  );
  await page.getByLabel("配置名称", { exact: true }).fill("连接二修改");
  await page.getByRole("button", { name: "保存 API 配置" }).click();
  const second = page.locator(".api-config-card").filter({ has: page.getByRole("heading", { name: "连接二修改", exact: true }) });
  await second.getByRole("button", { name: "停用配置", exact: true }).click();
  await expect(
    second.getByRole("button", { name: "测试连接", exact: true }),
  ).toBeDisabled();
  page.on("dialog", (d) => d.accept());
  await second.getByRole("button", { name: "编辑配置", exact: true }).click();
  await page.getByRole("button", { name: "删除配置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "连接二修改", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return db.apiCredentials.count();
    }),
  ).toBe(1);
});
test("测试 UI 状态、请求协议及安全错误分类", async ({ page }) => {
  await openSettings(page);
  await create(page, "测试连接配置");
  let request: any;
  await page.route("https://api.example.test/**", async (route) => {
    request = route.request();
    await new Promise((r) => setTimeout(r, 200));
    await route.fulfill({
      json: { choices: [{ message: { content: "Hi" } }] },
    });
  });
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "测试中…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("连接成功");
  expect(request.postDataJSON().max_tokens).toBe(1);
  await page.unroute("https://api.example.test/**");
  await page.route("https://api.example.test/**", (r) =>
    r.fulfill({
      status: 401,
      json: { error: { message: "test-only-not-a-real-key" } },
    }),
  );
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("认证失败");
  await expect(page.locator("body")).not.toContainText(
    "test-only-not-a-real-key",
  );
  const results = await page.evaluate(async () => {
    const { testConnection } = await import("/src/api.ts");
    const base = {
      id: "test",
      name: "test",
      provider: "openai",
      baseUrl: "https://example.test/v1",
      model: "test",
      temperature: 0.7,
      maxTokens: 100,
      enabled: true,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const calls: any[] = [];
    const check = async (c: any, status: number, data: any) =>
      testConnection(c, "synthetic-test-key", undefined, {
        send: async (url: any, init: any) => {
          calls.push({
            url,
            headers: init.headers,
            body: JSON.parse(init.body),
          });
          return new Response(JSON.stringify(data), { status });
        },
      });
    const statuses = [];
    for (const provider of [
      "openai",
      "openai-compatible",
      "openrouter",
      "gemini",
      "custom",
    ])
      statuses.push(
        await check(
          { ...base, provider, protocol: "openai-chat" },
          200,
          provider === "gemini" ? { candidates: [{}] } : { choices: [{}] },
        ),
      );
    statuses.push(await check({ ...base, provider: "custom" }, 200, {}));
    statuses.push(
      await check(base, 404, { error: { code: "model_not_found" } }),
    );
    statuses.push(await check(base, 404, {}));
    statuses.push(await check(base, 429, {}));
    statuses.push(await check(base, 200, { html: "bad" }));
    statuses.push(
      await testConnection(base, "synthetic", undefined, {
        send: async () => {
          throw Error("synthetic");
        },
      }),
    );
    statuses.push(
      await check({ ...base, baseUrl: "http://example.com" }, 200, {}),
    );
    return { statuses, calls };
  });
  expect(results.statuses.map((r: any) => r.status)).toEqual([
    "success",
    "success",
    "success",
    "success",
    "success",
    "unsupported",
    "model",
    "base-url",
    "other",
    "other",
    "network",
    "base-url",
  ]);
  expect(results.calls[0].body.max_completion_tokens).toBe(1);
  expect(results.calls[3].url).toContain("/models/test:generateContent");
  expect(results.calls[3].headers["x-goog-api-key"]).toBe("synthetic-test-key");
  expect(results.calls[3].body.generationConfig.maxOutputTokens).toBe(1);
});
test("v1 到 v2 迁移完整保留旧世界、角色、主题、桌面和资源", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    db.close();
    await new Promise<void>((resolve, reject) => {
      const d = indexedDB.deleteDatabase("claudia-phone");
      d.onsuccess = () => resolve();
      d.onerror = () => reject(d.error);
    });
    const seed: any = {
      worlds: [
        { id: "old-world", name: "旧世界", description: "保留", createdAt: 1 },
      ],
      characters: [
        {
          id: "old-character",
          worldId: "old-world",
          name: "旧角色",
          persona: "人设",
          avatar: "asset",
        },
      ],
      pages: [{ id: "page-1", order: 0 }],
      items: [
        {
          id: "old-item",
          kind: "app",
          app: "设置",
          pageId: "page-1",
          position: 0,
          size: 1,
        },
      ],
      themes: [
        {
          id: "global",
          color: "#abcdef",
          font: "sans",
          iconStyle: "rounded",
          opacity: 0.5,
          blur: 12,
        },
      ],
      assets: [{ id: "asset", type: "avatar", data: "sample", createdAt: 1 }],
    };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("claudia-phone", 10);
      open.onupgradeneeded = () => {
        for (const name of Object.keys(seed)) {
          const store = open.result.createObjectStore(name, { keyPath: "id" });
          const indexes: any = {
            worlds: ["createdAt"],
            characters: ["worldId"],
            pages: ["order"],
            items: ["pageId", "position"],
            themes: ["worldId"],
            assets: ["type"],
          };
          for (const index of indexes[name]) store.createIndex(index, index);
          for (const row of seed[name]) store.put(row);
        }
      };
      open.onsuccess = () => {
        open.result.close();
        resolve();
      };
      open.onerror = () => reject(open.error);
    });
    return seed;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "设置", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const result: any = {};
    for (const table of [
      "worlds",
      "characters",
      "pages",
      "items",
      "themes",
      "assets",
    ])
      result[table] = await db.table(table).toArray();
    return {
      records: result,
      configs: await db.apiConfigs.count(),
      credentials: await db.apiCredentials.count(),
    };
  });
  expect(after.records).toEqual(before);
  expect(after.configs).toBe(0);
  expect(after.credentials).toBe(0);
});
