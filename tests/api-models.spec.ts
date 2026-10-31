import { test, expect } from "@playwright/test";
async function form(page: any) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "AI / API 设置", exact: true })
    .click();
  await page
    .getByRole("button", { name: "＋ 添加 API 配置", exact: true })
    .click();
  await page.getByLabel("配置名称", { exact: true }).fill("模型体验测试");
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://models.example.test/v1/chat/completions/");
  await page.getByLabel("API Key", { exact: true }).fill("synthetic-model-key");
}
test("手机表单获取、搜索选择及真实测试当前未保存模型，不覆盖已保存配置", async ({
  page,
}) => {
  await form(page);
  let getUrl = "";
  let body: any;
  let auth = "";
  await page.route("https://models.example.test/**", async (r) => {
    getUrl = r.request().url();
    auth = r.request().headers().authorization;
    if (r.request().method() === "GET")
      await r.fulfill({
        json: {
          data: [{ id: "model-one" }, { id: "model-two", name: "Second" }],
        },
      });
    else {
      body = r.request().postDataJSON();
      await r.fulfill({ json: { choices: [{ message: { content: "ok" } }] } });
    }
  });
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await expect(page.getByLabel("选择模型")).toBeVisible();
  expect(getUrl).toBe("https://models.example.test/v1/models");
  expect(auth).toBe("Bearer synthetic-model-key");
  await page.getByLabel("搜索模型").fill("Second");
  await page.getByLabel("选择模型").selectOption("model-two");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "model-two",
  );
  await page
    .getByRole("button", { name: "测试连接（当前表单）", exact: true })
    .click();
  await expect(page.locator(".api-draft-result")).toContainText("连接成功");
  expect(body.model).toBe("model-two");
  expect(body.max_tokens).toBe(1);
  expect(getUrl).toBe("https://models.example.test/v1/chat/completions");
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return db.apiConfigs.count();
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "保存 API 配置" }).click();
  await page.locator(".api-config-card").click();
  await page.getByLabel("Model", { exact: true }).fill("manual-unchanged");
  await page.unroute("https://models.example.test/**");
  await page.route("https://models.example.test/**", (r) =>
    r.fulfill({
      status: 404,
      json: { error: { message: "synthetic-model-key" } },
    }),
  );
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await expect(page.locator(".api-model-result")).toContainText(
    "获取模型列表接口不受支持",
  );
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "manual-unchanged",
  );
  await expect(page.locator("body")).not.toContainText("synthetic-model-key");
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return (await db.apiConfigs.toArray())[0].model;
    }),
  ).toBe("model-two");
});
test("Gemini 自身列表协议、分页和文本模型筛选", async ({ page }) => {
  await form(page);
  await page.getByLabel("Provider", { exact: true }).selectOption("gemini");
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://gemini-models.example.test/v1beta");
  const urls: string[] = [];
  await page.route("https://gemini-models.example.test/**", async (r) => {
    urls.push(r.request().url());
    expect(r.request().headers()["x-goog-api-key"]).toBe("synthetic-model-key");
    expect(r.request().url()).not.toContain("synthetic-model-key");
    const page2 = new URL(r.request().url()).searchParams.get("pageToken");
    await r.fulfill({
      json: page2
        ? {
            models: [
              {
                name: "models/generation-two",
                displayName: "Second",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
          }
        : {
            models: [
              {
                name: "models/embedding",
                supportedGenerationMethods: ["embedContent"],
              },
              {
                name: "models/generation-one",
                supportedGenerationMethods: ["generateContent"],
              },
            ],
            nextPageToken: "next",
          },
    });
  });
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await expect(page.locator(".api-model-result")).toContainText(
    "已获取 2 个模型",
  );
  expect(urls).toHaveLength(2);
  expect(urls[0]).toContain("/v1beta/models?pageSize=1000");
  expect(urls[1]).toContain("pageToken=next");
  await page.getByLabel("选择模型").selectOption("generation-two");
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "generation-two",
  );
  expect(
    await page.getByLabel("选择模型").locator("option").allTextContents(),
  ).not.toContain("embedding");
});
test("所有列表适配器与认证、接口、网络及超时错误，绝不回显凭据", async ({
  page,
}) => {
  await form(page);
  const result = await page.evaluate(async () => {
    const { fetchModels } = await import("/src/apiModels.ts");
    const { testConnection } = await import("/src/api.ts");
    const base = {
      id: "test",
      name: "test",
      provider: "openai",
      baseUrl: "https://example.test/v1",
      model: "manual",
      temperature: 0.7,
      maxTokens: 20,
      enabled: true,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const requests: any[] = [];
    const statuses = [];
    for (const provider of [
      "openai",
      "openai-compatible",
      "openrouter",
      "custom",
    ]) {
      const r = await fetchModels(
        { ...base, provider, protocol: "openai-chat" as const },
        "synthetic-key",
        undefined,
        {
          send: async (url, init) => {
            requests.push({ url, method: init.method });
            return new Response(
              JSON.stringify({
                data: [{ id: "model" }, { id: "synthetic-key" }],
              }),
              { status: 200 },
            );
          },
        },
      );
      statuses.push(r.result.status);
      if (r.models.length !== 1) throw Error("credential echo not filtered");
    }
    for (const status of [401, 403, 404, 405, 501, 500])
      statuses.push(
        (
          await fetchModels(base, "synthetic-key", undefined, {
            send: async () =>
              new Response(
                JSON.stringify({ error: { message: "synthetic-key" } }),
                { status },
              ),
          })
        ).result.status,
      );
    statuses.push(
      (
        await fetchModels(base, "synthetic-key", undefined, {
          send: async () => {
            throw Error("synthetic-key");
          },
        })
      ).result.status,
    );
    statuses.push(
      (
        await fetchModels(
          { ...base, baseUrl: "http://example.test" },
          "synthetic-key",
        )
      ).result.status,
    );
    statuses.push(
      (
        await testConnection(base, "synthetic-key", undefined, {
          send: async () =>
            new Response(
              JSON.stringify({ error: { code: "model_not_found" } }),
              { status: 404 },
            ),
        })
      ).status,
    );
    const c = new AbortController();
    c.abort();
    statuses.push(
      (
        await fetchModels(base, "synthetic-key", c.signal, {
          send: async () => {
            throw Error("abort");
          },
        })
      ).result.status,
    );
    return { statuses, requests };
  });
  expect(result.statuses).toEqual([
    "success",
    "success",
    "success",
    "success",
    "authentication",
    "authentication",
    "unsupported",
    "unsupported",
    "unsupported",
    "base-url",
    "network",
    "base-url",
    "model",
    "cancelled",
  ]);
  expect(
    result.requests.every(
      (r: any) =>
        r.url === "https://example.test/v1/models" && r.method === "GET",
    ),
  ).toBe(true);
  await page.clock.install();
  await page.route("https://models.example.test/**", (r) =>
    r.abort("timedout"),
  );
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await expect(page.locator(".api-model-result")).toContainText(
    "浏览器跨域限制",
  );
  await expect(page.locator(".api-model-result strong")).toHaveText("网络错误");
  await page.unroute("https://models.example.test/**");
  await page.route("https://models.example.test/**", () => {});
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await page.clock.fastForward(21000);
  await expect(page.locator(".api-model-result")).toContainText("请求超时");
});
test("修改地址或凭据时取消旧列表，防止过期结果覆盖当前表单", async ({
  page,
}) => {
  await form(page);
  await page.getByLabel("Model", { exact: true }).fill("keep-manual");
  await page.route("https://models.example.test/**", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await r.fulfill({ json: { data: [{ id: "stale" }] } }).catch(() => {});
  });
  await page.getByRole("button", { name: "获取模型", exact: true }).click();
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("https://other.example.test/v1");
  await page.waitForTimeout(400);
  await expect(page.getByLabel("选择模型")).toHaveCount(0);
  await expect(page.getByLabel("Model", { exact: true })).toHaveValue(
    "keep-manual",
  );
  await expect(
    page.getByRole("button", { name: "获取模型", exact: true }),
  ).toBeEnabled();
});
