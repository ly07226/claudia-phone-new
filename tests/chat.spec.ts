import { test, expect } from "@playwright/test";
async function seed(page: any) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  return page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    await db.worlds.bulkPut([
      {
        id: "test-a",
        name: "测试空间一",
        description: "setting-a",
        createdAt: 1,
      },
      {
        id: "test-b",
        name: "测试空间二",
        description: "setting-b",
        createdAt: 1,
      },
    ]);
    await db.characters.put({
      id: "test-c",
      name: "测试角色",
      persona: "base-persona",
      speakingStyle: "concise",
    });
    await db.worldProfiles.bulkPut([
      {
        id: "p-a",
        worldId: "test-a",
        characterId: "test-c",
        setting: "profile-a",
      },
      {
        id: "p-b",
        worldId: "test-b",
        characterId: "test-c",
        setting: "profile-b",
      },
    ]);
    await db.apiConfigs.put({
      id: "test-api",
      name: "测试 API",
      provider: "openai-compatible",
      baseUrl: "https://chat.example.test/v1",
      model: "model",
      temperature: 0.7,
      maxTokens: 50,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.apiCredentials.put({
      configId: "test-api",
      apiKey: "synthetic-chat-test-key",
    });
    const { getConversation } = await import("/src/chatService.ts");
    return {
      daily: await getConversation("test-c"),
      a: await getConversation("test-c", "test-a"),
      b: await getConversation("test-c", "test-b"),
    };
  });
}
test("同角色三空间真实请求上下文隔离、持久化、截断及删除范围", async ({
  page,
}) => {
  const conversations = await seed(page);
  const requests: any[] = [];
  await page.route("https://chat.example.test/**", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: { choices: [{ message: { content: "reply-" + requests.length } }] },
    });
  });
  await page.evaluate(async ({ daily, a, b }) => {
    const { sendMessage } = await import("/src/chatService.ts");
    await sendMessage(daily.id, "daily-only");
    await sendMessage(a.id, "world-a-only");
    await sendMessage(b.id, "world-b-only");
    await sendMessage(a.id, "world-a-next");
  }, conversations);
  const combined = requests.map((r) => JSON.stringify(r.messages));
  expect(combined[0]).not.toMatch(
    /setting-a|setting-b|profile-a|profile-b|world-a-only|world-b-only/,
  );
  expect(combined[1]).toContain("setting-a");
  expect(combined[1]).not.toMatch(/setting-b|daily-only|world-b-only/);
  expect(combined[2]).toContain("setting-b");
  expect(combined[2]).not.toMatch(/setting-a|daily-only|world-a-only/);
  expect(combined[3]).toContain("world-a-only");
  expect(combined[3]).not.toMatch(/daily-only|world-b-only|setting-b/);
  await page.reload();
  const saved = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return { c: await db.conversations.count(), m: await db.messages.count() };
  });
  expect(saved).toEqual({ c: 3, m: 8 });
  const truncated = await page.evaluate(async ({ daily, a }) => {
    const { db } = await import("/src/store.ts");
    for (let n = 0; n < 60; n++)
      await db.messages.add({
        id: crypto.randomUUID(),
        conversationId: daily.id,
        role: n % 2 ? "assistant" : "user",
        content: "x".repeat(1500),
        createdAt: Date.now() + n,
      });
    const { buildContext } = await import("/src/chatContext.ts");
    const context = await buildContext(daily);
    const { deleteConversation } = await import("/src/chatService.ts");
    await deleteConversation(a.id);
    return {
      count: context.length,
      size: context.slice(1).reduce((n, m) => n + m.content.length, 0),
      dailyMessages: await db.messages
        .where("conversationId")
        .equals(daily.id)
        .count(),
      aMessages: await db.messages.where("conversationId").equals(a.id).count(),
      worlds: await db.worlds.count(),
      characters: await db.characters.count(),
      conversations: await db.conversations.count(),
    };
  }, conversations);
  expect(truncated.count).toBeLessThanOrEqual(31);
  expect(truncated.size).toBeLessThanOrEqual(24000);
  expect(truncated.dailyMessages).toBe(62);
  expect(truncated.aMessages).toBe(0);
  expect(truncated.worlds).toBe(2);
  expect(truncated.characters).toBe(1);
  expect(truncated.conversations).toBe(2);
  await page.evaluate(async ({ b }) => {
    const { deleteWorld } = await import("/src/chatService.ts");
    await deleteWorld("test-b");
  }, conversations);
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return {
        characters: await db.characters.count(),
        conversations: await db.conversations.count(),
        worlds: await db.worlds.count(),
      };
    }),
  ).toEqual({ characters: 1, conversations: 1, worlds: 1 });
});
test("无世界创建基础角色、无 API 引导、失败保留消息和重试、刷新记录", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "角色管理", exact: true }).click();
  await page.getByRole("button", { name: "创建角色", exact: true }).click();
  await page.getByLabel("角色姓名", { exact: true }).fill("无世界测试角色");
  await page.getByLabel("角色人设", { exact: true }).fill("基础人格");
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "无世界测试角色", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回桌面" }).click();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /无世界测试角色/ }).click();
  await expect(page.getByRole("alert")).toContainText("没有可用 API");
  await page.getByLabel("聊天消息").fill("失败时不要丢失我");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重试最后一条消息" }),
  ).toBeVisible();
  await expect(page.locator(".chat-bubble")).toHaveCount(1);
  await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    await db.apiConfigs.put({
      id: "api",
      name: "test",
      provider: "gemini",
      baseUrl: "https://gemini.example.test/v1beta",
      model: "test-model",
      temperature: 0.6,
      maxTokens: 100,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.apiCredentials.put({
      configId: "api",
      apiKey: "synthetic-test-key",
    });
  });
  let body: any;
  await page.route("https://gemini.example.test/**", async (r) => {
    body = r.request().postDataJSON();
    await r.fulfill({
      status: 403,
      json: { error: { message: "synthetic-test-key" } },
    });
  });
  await page.getByRole("button", { name: "重试最后一条消息" }).click();
  await expect(page.getByRole("alert")).toContainText("认证失败");
  await expect(page.locator(".chat-bubble")).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("synthetic-test-key");
  await page.unroute("https://gemini.example.test/**");
  await page.route("https://gemini.example.test/**", (r) =>
    r.fulfill({
      json: { candidates: [{ content: { parts: [{ text: "已经回复" }] } }] },
    }),
  );
  await page.getByRole("button", { name: "重试最后一条消息" }).click();
  await expect(page.locator(".chat-assistant")).toContainText("已经回复");
  expect(body.systemInstruction.parts[0].text).toContain("基础人格");
  expect(body.contents).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /无世界测试角色/ }).click();
  await expect(page.locator(".chat-bubble")).toHaveCount(2);
});
test("v2 到 v3 保留所有旧表与凭据并只创建旧角色关联", async ({ page }) => {
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
    const records: any = {
      worlds: [
        { id: "w", name: "legacy-world", description: "old", createdAt: 1 },
      ],
      characters: [
        {
          id: "c",
          worldId: "w",
          name: "legacy-character",
          persona: "old",
          apiConfigId: "api",
        },
      ],
      themes: [
        {
          id: "global",
          color: "#abcdef",
          font: "sans",
          iconStyle: "rounded",
          opacity: 0.4,
          blur: 18,
        },
      ],
      pages: [{ id: "page-1", order: 0 }],
      items: [
        {
          id: "item",
          kind: "app",
          app: "聊天",
          pageId: "page-1",
          position: 0,
          size: 1,
        },
      ],
      assets: [{ id: "asset", type: "icon", data: "sample", createdAt: 1 }],
      apiConfigs: [
        {
          id: "api",
          name: "legacy-api",
          provider: "custom",
          baseUrl: "https://example.test",
          model: "model",
          temperature: 0.5,
          maxTokens: 100,
          enabled: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      apiCredentials: [{ configId: "api", apiKey: "synthetic-legacy-key" }],
    };
    await new Promise<void>((resolve, reject) => {
      const o = indexedDB.open("claudia-phone", 20);
      o.onupgradeneeded = () => {
        const indexes: any = {
          worlds: ["createdAt"],
          characters: ["worldId"],
          themes: ["worldId"],
          pages: ["order"],
          items: ["pageId", "position"],
          assets: ["type"],
          apiConfigs: ["provider"],
          apiCredentials: [],
        };
        for (const name of Object.keys(records)) {
          const t = o.result.createObjectStore(name, {
            keyPath: name === "apiCredentials" ? "configId" : "id",
          });
          for (const index of indexes[name]) t.createIndex(index, index);
          for (const row of records[name]) t.put(row);
        }
      };
      o.onsuccess = () => {
        o.result.close();
        resolve();
      };
      o.onerror = () => reject(o.error);
    });
    return records;
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  const after = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const records: any = {};
    for (const name of [
      "worlds",
      "characters",
      "themes",
      "pages",
      "items",
      "assets",
      "apiConfigs",
      "apiCredentials",
    ])
      records[name] = await db.table(name).toArray();
    return { records, profiles: await db.worldProfiles.toArray() };
  });
  expect(after.records).toEqual(before);
  expect(after.profiles).toHaveLength(1);
  expect(after.profiles[0]).toMatchObject({
    characterId: "c",
    worldId: "w",
    setting: "",
  });
});
test("API 选择优先级、停用不静默回退和重复会话唯一", async ({ page }) => {
  const { daily } = await seed(page);
  const result = await page.evaluate(
    async ({ daily }) => {
      const { db } = await import("/src/store.ts");
      const { resolveApi, getConversation } =
        await import("/src/chatService.ts");
      const base = await db.apiConfigs.get("test-api");
      await db.apiConfigs.bulkPut([
        { ...base!, id: "character-api", isDefault: false },
        { ...base!, id: "conversation-api", isDefault: false },
      ]);
      await db.apiCredentials.bulkPut([
        { configId: "character-api", apiKey: "synthetic" },
        { configId: "conversation-api", apiKey: "synthetic" },
      ]);
      const selected = [];
      selected.push((await resolveApi(daily)).config.id);
      await db.characters.update("test-c", { apiConfigId: "character-api" });
      selected.push((await resolveApi(daily)).config.id);
      daily.apiConfigId = "conversation-api";
      selected.push((await resolveApi(daily)).config.id);
      await db.apiConfigs.update("conversation-api", { enabled: false });
      let failed = false;
      try {
        await resolveApi(daily);
      } catch {
        failed = true;
      }
      return { selected, failed, id: (await getConversation("test-c")).id };
    },
    { daily },
  );
  expect(result.selected).toEqual([
    "test-api",
    "character-api",
    "conversation-api",
  ]);
  expect(result.failed).toBe(true);
  expect(result.id).toBe(daily.id);
});
test("世界专属资料可编辑，共用基础角色不复制", async ({ page }) => {
  await seed(page);
  await page.reload();
  await page.getByRole("button", { name: "世界管理", exact: true }).click();
  await page
    .locator(".card")
    .filter({
      has: page.getByRole("heading", { name: "测试空间一", exact: true }),
    })
    .getByRole("button", { name: "查看角色" })
    .click();
  await page.getByRole("button", { name: "编辑世界设定", exact: true }).click();
  await page.getByLabel("世界角色设定").fill("用户自定义身份资料");
  await page.getByRole("button", { name: "保存世界角色设定" }).click();
  await expect(
    page.getByRole("button", { name: "保存世界角色设定" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "进入世界聊天" }).click();
  await expect(page.locator(".chat-world-caption")).toContainText(
    "世界聊天 · 测试空间一",
  );
  await page.getByRole("button", { name: /测试角色.*开始/ }).click();
  const data = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return {
      characters: await db.characters.count(),
      profiles: await db.worldProfiles.toArray(),
    };
  });
  expect(data.characters).toBe(1);
  expect(data.profiles.find((p: any) => p.worldId === "test-a").setting).toBe(
    "用户自定义身份资料",
  );
  expect(data.profiles.find((p: any) => p.worldId === "test-b").setting).toBe(
    "profile-b",
  );
});
test("并发发送受保护，取消与删除会话不产生孤立回复", async ({ page }) => {
  const { daily } = await seed(page);
  await page.route("https://chat.example.test/**", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await r
      .fulfill({ json: { choices: [{ message: { content: "reply" } }] } })
      .catch(() => {});
  });
  const result = await page.evaluate(
    async ({ daily }) => {
      const { db } = await import("/src/store.ts");
      const { sendMessage, deleteConversation, getConversation } =
        await import("/src/chatService.ts");
      let release!: () => void;
      const saved = new Promise<void>((r) => (release = r));
      const first = sendMessage(daily.id, "first", undefined, false, async () =>
        release(),
      ).catch((e) => e.message);
      await saved;
      let duplicate = false;
      try {
        await sendMessage(daily.id, "duplicate");
      } catch {
        duplicate = true;
      }
      await first;
      const count = await db.messages
        .where("conversationId")
        .equals(daily.id)
        .count();
      const controller = new AbortController();
      let releaseSecond!: () => void;
      const savedSecond = new Promise<void>((r) => (releaseSecond = r));
      const second = sendMessage(
        daily.id,
        "cancel",
        controller.signal,
        false,
        async () => {
          releaseSecond();
          controller.abort();
        },
      ).catch((e) => e.message);
      await savedSecond;
      await second;
      const cancelCount = await db.messages
        .where("conversationId")
        .equals(daily.id)
        .count();
      await deleteConversation(daily.id);
      const c = await getConversation("test-c");
      let releaseThird!: () => void;
      const savedThird = new Promise<void>((r) => (releaseThird = r));
      const third = sendMessage(c.id, "delete", undefined, false, async () => {
        releaseThird();
        await deleteConversation(c.id);
      }).catch((e) => e.message);
      await savedThird;
      await third;
      return {
        duplicate,
        count,
        cancelCount,
        orphan: await db.messages.where("conversationId").equals(c.id).count(),
        conversation: await db.conversations.get(c.id),
      };
    },
    { daily },
  );
  expect(result.duplicate).toBe(true);
  expect(result.count).toBe(2);
  expect(result.cancelCount).toBe(3);
  expect(result.orphan).toBe(0);
  expect(result.conversation).toBeUndefined();
});
test("2.1 回退兼容表声明可打开当前 v5，聊天与旧数据保持不变", async ({
  page,
}) => {
  const conversations = await seed(page);
  const result = await page.evaluate(async ({ daily }) => {
    const { db } = await import("/src/store.ts");
    await db.messages.add({
      id: "rollback-message",
      conversationId: daily.id,
      role: "user",
      content: "preserve",
      createdAt: 1,
    });
    const names = db.tables.map((t) => t.name);
    const before: any = {};
    for (const name of names) before[name] = await db.table(name).toArray();
    const DexieBase = Object.getPrototypeOf(db.constructor);
    db.close();
    const compatibility = new DexieBase("claudia-phone");
    compatibility.version(1).stores({
      worlds: "id,createdAt",
      characters: "id,worldId",
      pages: "id,order",
      items: "id,pageId,position",
      themes: "id,worldId",
      assets: "id,type",
    });
    compatibility
      .version(2)
      .stores({ apiConfigs: "id,provider", apiCredentials: "configId" });
    compatibility.version(3).stores({
      conversations: "id,&scopeKey,characterId,worldId,updatedAt",
      messages: "id,conversationId,[conversationId+createdAt]",
      worldProfiles: "id,&[worldId+characterId],worldId,characterId",
    });
    compatibility
      .version(4)
      .stores({ lorebooks: "id,updatedAt", loreEntries: "id,lorebookId" });
    compatibility
      .version(5)
      .stores({
        messageVariants: "id,messageId,conversationId",
        messageRevisions: "id,messageId,conversationId,variantId",
        conversationSnapshots: "id,conversationId,createdAt",
      });
    await compatibility.open();
    const after: any = {};
    for (const name of names)
      after[name] = await compatibility.table(name).toArray();
    compatibility.close();
    return { before, after };
  }, conversations);
  expect(result.after).toEqual(result.before);
});
