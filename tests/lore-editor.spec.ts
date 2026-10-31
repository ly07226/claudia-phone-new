import { test, expect } from "@playwright/test";
async function open(page: any) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "世界书 / Lorebook", exact: true })
    .click();
}
test("iPhone 点击明确导入按钮触发文件选择器并预览确认", async ({ page }) => {
  await open(page);
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: "从 JSON 导入世界书", exact: true })
    .click();
  const fileChooser = await chooser;
  await fileChooser.setFiles({
    name: "mobile-world.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        entries: {
          0: {
            uid: 0,
            key: ["night"],
            comment: "外部完整条目",
            content: "test",
            constant: false,
            position: 4,
            depth: 2,
            role: 1,
            order: 150,
            useProbability: true,
            probability: 50,
            scanDepth: 1,
            useRegex: true,
          },
        },
      }),
    ),
  });
  await expect(page.getByRole("heading", { name: "导入预览" })).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return db.lorebooks.count();
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "确认导入" }).click();
  await page
    .getByRole("button", { name: "展开世界书 mobile-world", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "外部完整条目", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "展开条目 外部完整条目", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑条目", exact: true }).click();
  await expect(page.getByLabel("条目插入位置")).toHaveValue("at-depth");
  await expect(page.getByLabel("注入深度 Depth")).toHaveValue("2");
  await expect(page.getByLabel("条目消息角色")).toHaveValue("user");
  await expect(page.getByLabel("触发概率", { exact: true })).toHaveValue("50");
  await expect(page.getByLabel("使用正则", { exact: true })).toBeChecked();
});
test("完整编辑器保存、折叠摘要、复制、非法正则提示和普通 v4 默认值", async ({
  page,
}) => {
  await open(page);
  await page.getByRole("button", { name: "新建世界书", exact: true }).click();
  await page.getByLabel("世界书名称", { exact: true }).fill("参数测试");
  await page.getByRole("button", { name: "保存世界书" }).click();
  await page
    .getByRole("button", { name: "展开世界书 参数测试", exact: true })
    .click();
  await page.getByRole("button", { name: "新增条目" }).click();
  await page.getByLabel("条目名称", { exact: true }).fill("参数条目");
  await page.getByLabel("条目内容", { exact: true }).fill("RP content");
  await page.getByLabel("使用正则", { exact: true }).check();
  await page.getByLabel("条目关键词", { exact: true }).fill("[");
  await expect(page.getByRole("alert")).toContainText("正则无效");
  await page.getByRole("button", { name: "保存条目" }).click();
  await expect(
    page.getByRole("heading", { name: "编辑条目", exact: true }),
  ).toBeVisible();
  await page.getByLabel("条目关键词", { exact: true }).fill("\\d{1,3}");
  await page.getByLabel("正则测试文本").fill("123");
  await page.getByRole("button", { name: "测试正则" }).click();
  await expect(page.getByRole("status")).toContainText("主关键词命中：是");
  await page.getByLabel("条目插入位置").selectOption("at-depth");
  await page.getByLabel("注入深度 Depth").fill("2");
  await page.getByLabel("条目消息角色").selectOption("assistant");
  await page.getByLabel("启用触发概率").check();
  await page.getByLabel("触发概率", { exact: true }).fill("100");
  await page
    .locator("details")
    .filter({ has: page.getByText("高级设置", { exact: true }) })
    .locator("summary")
    .click();
  await page.getByLabel("条目扫描深度").fill("1");
  await page.getByRole("button", { name: "保存条目" }).click();
  await expect(
    page.getByRole("heading", { name: "编辑条目", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".lore-entry-card .lore-fold-title")).toContainText(
    "参数条目",
  );
  await page
    .getByRole("button", { name: "展开条目 参数条目", exact: true })
    .click();
  await page.getByRole("button", { name: "复制条目" }).click();
  await expect(
    page.getByRole("heading", { name: "参数条目（副本）", exact: true }),
  ).toBeVisible();
  const data = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { normalizeEntry } = await import("/src/loreTypes.ts");
    const rows = await db.loreEntries.toArray();
    const legacy = { ...rows[0] };
    delete legacy.regex;
    delete legacy.insertionDepth;
    delete legacy.role;
    delete legacy.useProbability;
    delete legacy.probability;
    return { rows, legacy: normalizeEntry(legacy), version: db.verno };
  });
  expect(data.rows).toHaveLength(2);
  expect(
    data.rows.every(
      (e: any) =>
        e.primaryKeys[0] === "\\d{1,3}" &&
        e.scanDepth === 1 &&
        e.insertionDepth === 2 &&
        e.role === "assistant" &&
        e.probability === 100,
    ),
  ).toBe(true);
  expect(data.legacy).toMatchObject({
    regex: false,
    insertionDepth: 0,
    role: "system",
    useProbability: false,
    probability: 100,
  });
  expect(data.version).toBe(6);
});
test("纯函数激活、稳定排序、概率边界、正则安全、位置与扫描深度独立", async ({
  page,
}) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { newBook, newEntry } = await import("/src/loreTypes.ts");
    const { entryActive, planLore, injectLore } =
      await import("/src/loreEngine.ts");
    const { evaluateRegex } = await import("/src/loreRegex.ts");
    const book = { ...newBook(), name: "test", global: true, charBudget: 8000 };
    const base = { ...newEntry(book.id), triggerMode: "history" as const, id: "a", createdAt: 1, content: "A" };
    const history: any = [
      {
        id: "1",
        conversationId: "test",
        role: "user",
        content: "old trigger",
        createdAt: 1,
      },
      {
        id: "2",
        conversationId: "test",
        role: "assistant",
        content: "recent",
        createdAt: 2,
      },
    ];
    const conditions = {
      constant: entryActive({ ...base, constant: true }, book, history),
      literal: entryActive({ ...base, primaryKeys: ["recent"] }, book, history),
      disabled: entryActive(
        { ...base, enabled: false, constant: true },
        book,
        history,
      ),
      zero: entryActive(
        { ...base, constant: true, useProbability: true, probability: 0 },
        book,
        history,
        () => 0,
      ),
      hundred: entryActive(
        { ...base, constant: true, useProbability: true, probability: 100 },
        book,
        history,
        () => 0.999,
      ),
      mockTrue: entryActive(
        { ...base, constant: true, useProbability: true, probability: 50 },
        book,
        history,
        () => 0.1,
      ),
      mockFalse: entryActive(
        { ...base, constant: true, useProbability: true, probability: 50 },
        book,
        history,
        () => 0.8,
      ),
      scanMiss: entryActive(
        { ...base, primaryKeys: ["trigger"], scanDepth: 1, insertionDepth: 30 },
        book,
        history,
      ),
      scanHit: entryActive(
        { ...base, primaryKeys: ["trigger"], scanDepth: 2, insertionDepth: 0 },
        book,
        history,
      ),
    };
    const regex = await evaluateRegex([
      {
        id: "valid",
        text: "item 123",
        primary: ["/item \\d{1,3}/i"],
        secondary: [],
        caseSensitive: false,
      },
      {
        id: "invalid",
        text: "x",
        primary: ["["],
        secondary: [],
        caseSensitive: false,
      },
    ]);
    const regexActive = entryActive(
      { ...base, regex: true, primaryKeys: ["/item \\d{1,3}/i"] },
      book,
      history,
      () => 0,
      regex.valid,
    );
    const invalid = entryActive(
      { ...base, regex: true, primaryKeys: ["["] },
      book,
      history,
      () => 0,
      regex.invalid,
    );
    const a = { ...base, constant: true };
    const b = { ...a, id: "b", content: "B" };
    const sorted1 = planLore(
      [
        { entry: b, book },
        { entry: a, book },
      ],
      history,
      8000,
      () => 0,
    ).activated;
    const sorted2 = planLore(
      [
        { entry: a, book },
        { entry: b, book },
      ],
      history,
      8000,
      () => 0,
    ).activated;
    const make = (
      id: string,
      position: any,
      role: any = "system",
      depth = 0,
    ) => ({
      ...base,
      id,
      content: id,
      constant: true,
      insertionPosition: position,
      role,
      insertionDepth: depth,
    });
    const messages = injectLore(
      "BASE",
      [
        { role: "user", content: "U" },
        { role: "assistant", content: "A" },
      ],
      [
        make("PRE", "before-profile"),
        make("POST", "after-profile"),
        make("BEFORE", "before-conversation", "user"),
        make("DEPTH", "at-depth", "system", 1),
        make("END", "after-conversation", "assistant"),
      ],
    );
    return {
      conditions,
      regexActive,
      invalid,
      regexError: !!regex.invalid.error,
      sorted1,
      sorted2,
      messages,
    };
  });
  expect(r.conditions).toEqual({
    constant: true,
    literal: true,
    disabled: false,
    zero: false,
    hundred: true,
    mockTrue: true,
    mockFalse: false,
    scanMiss: false,
    scanHit: true,
  });
  expect(r.regexActive).toBe(true);
  expect(r.invalid).toBe(false);
  expect(r.regexError).toBe(true);
  expect(r.sorted1).toEqual(["a", "b"]);
  expect(r.sorted2).toEqual(r.sorted1);
  expect(r.messages[0]).toEqual({
    role: "system",
    content: "PRE\n\nBASE\n\nPOST",
  });
  expect(r.messages.slice(1)).toEqual([
    { role: "user", content: "BEFORE" },
    { role: "user", content: "U" },
    { role: "system", content: "DEPTH" },
    { role: "assistant", content: "A" },
    { role: "assistant", content: "END" },
  ]);
});
test("最终 API 请求保留 Role，Gemini 安全降级并保留位置内容", async ({
  page,
}) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { requestReply } = await import("/src/chatProvider.ts");
    const messages: any = [
      { role: "system", content: "base" },
      { role: "user", content: "USER_LORE" },
      { role: "user", content: "question" },
      { role: "system", content: "DEPTH_SYSTEM" },
      { role: "assistant", content: "ASSISTANT_LORE" },
    ];
    const base: any = {
      id: "test",
      name: "test",
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "model",
      temperature: 0.5,
      maxTokens: 100,
      enabled: true,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const bodies: any[] = [];
    for (const provider of ["openai-compatible", "gemini"])
      await requestReply(
        { ...base, provider },
        "synthetic-key",
        messages,
        new AbortController().signal,
        {
          send: async (_url, init) => {
            bodies.push(JSON.parse(init.body as string));
            return new Response(
              JSON.stringify(
                provider === "gemini"
                  ? { candidates: [{ content: { parts: [{ text: "ok" }] } }] }
                  : { choices: [{ message: { content: "ok" } }] },
              ),
              { status: 200 },
            );
          },
        },
      );
    return bodies;
  });
  expect(r[0].messages.map((m: any) => m.role)).toEqual([
    "system",
    "user",
    "user",
    "system",
    "assistant",
  ]);
  expect(r[1].systemInstruction.parts[0].text).toBe("base");
  expect(r[1].contents.map((m: any) => m.role)).toEqual(["user"]);
  expect(JSON.stringify(r[1].contents)).toContain("DEPTH_SYSTEM");
  expect(JSON.stringify(r[1].contents)).toContain("ASSISTANT_LORE");
});
test("明确角色不支持时安全降级一次，异常正则不会冻结聊天", async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const { requestReply } = await import("/src/chatProvider.ts");
    const { evaluateRegex } = await import("/src/loreRegex.ts");
    const config: any = {
      id: "t",
      name: "t",
      provider: "openai-compatible",
      baseUrl: "https://example.test/v1",
      model: "m",
      temperature: 0.5,
      maxTokens: 50,
      enabled: true,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1,
    };
    const requests: any[] = [];
    await requestReply(
      config,
      "synthetic-key",
      [
        { role: "system", content: "base" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "lore" },
      ],
      new AbortController().signal,
      {
        send: async (_u, init) => {
          requests.push(JSON.parse(init.body as string));
          return new Response(
            JSON.stringify(
              requests.length === 1
                ? {
                    error: {
                      code: "unsupported_role",
                      message: "synthetic-key",
                    },
                  }
                : { choices: [{ message: { content: "ok" } }] },
            ),
            { status: requests.length === 1 ? 400 : 200 },
          );
        },
      },
    );
    const before = performance.now();
    const timeout = await evaluateRegex([
      {
        id: "danger",
        text: "a".repeat(20000) + "!",
        primary: ["(a+)+$"],
        secondary: [],
        caseSensitive: true,
      },
    ]);
    return {
      requests,
      timeout: !!timeout.danger.error,
      elapsed: performance.now() - before,
    };
  });
  expect(r.requests).toHaveLength(2);
  expect(r.requests[1].messages.every((m: any) => m.role === "user")).toBe(
    true,
  );
  expect(r.requests[1].messages[0].content).toContain("base");
  expect(r.timeout).toBe(true);
  expect(r.elapsed).toBeLessThan(4000);
});
