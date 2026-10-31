import { test, expect, type Page } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
async function openScripts(page: Page) {
  await expect(page.getByRole("heading", { name: "选择空间", exact: true })).toBeVisible();
  const entry = page.getByRole("button", { name: "剧本", exact: true });
  if (await entry.count()) await entry.click();
}
async function selector(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
}
async function seed(page: Page) {
  await openScripts(page);
  return page.evaluate(async () => {
    const { db, usePhone } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    await db.worlds.bulkPut([
      {
        id: "space:a/一",
        name: "自定义甲",
        description: "世界甲设定",
        createdAt: 1,
      },
      {
        id: "space-b",
        name: "自定义乙",
        description: "世界乙设定",
        createdAt: 2,
      },
    ]);
    await db.characters.put({
      id: "space-role",
      name: "共用角色",
      persona: "基础人格",
    });
    await db.worldProfiles.bulkPut([
      {
        id: "space-pa",
        characterId: "space-role",
        worldId: "space:a/一",
        setting: "甲身份",
      },
      {
        id: "space-pb",
        characterId: "space-role",
        worldId: "space-b",
        setting: "乙身份",
      },
    ]);
    const daily = await getConversation("space-role");
    const a = await getConversation("space-role", "space:a/一");
    const b = await getConversation("space-role", "space-b");
    for (const [c, content] of [
      [daily, "DAILY_ONLY"],
      [a, "WORLD_A_ONLY"],
    ] as const) {
      await db.messages.put({
        id: `${c.id}-user`,
        conversationId: c.id,
        role: "user",
        content,
        createdAt: 1,
      });
      await db.messages.put({
        id: `${c.id}-ai`,
        conversationId: c.id,
        role: "assistant",
        content: `${content}_REPLY`,
        activeVariantId: `${c.id}-v1`,
        createdAt: 2,
      });
      await db.messageVariants.put({
        id: `${c.id}-v1`,
        conversationId: c.id,
        messageId: `${c.id}-ai`,
        content: `${content}_REPLY`,
        source: "legacy",
        createdAt: 2,
      });
    }
    await db.apiConfigs.put({
      id: "space-api",
      name: "测试连接",
      provider: "openai-compatible",
      baseUrl: "https://space.example.test/v1",
      model: "space-model",
      temperature: 0.7,
      maxTokens: 100,
      enabled: true,
      isDefault: true,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.apiCredentials.put({
      configId: "space-api",
      apiKey: "synthetic-space-key",
    });
    await usePhone.getState().reload();
    return { daily, a, b };
  });
}
async function checkSpace(page: Page, id: string) {
  expect(
    await page.evaluate(
      async () =>
        (await import("/src/spaces.ts")).useSpaces.getState().space?.spaceId,
    ),
  ).toBe(id);
}
async function chat(page: Page) {
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /共用角色.*开始/ }).click();
}
async function leaveChat(page: Page) {
  await page.getByRole("button", { name: "会话管理", exact: true }).click();
  await page.getByRole("button", { name: "返回空间列表", exact: true }).click();
  await openScripts(page);
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
}

test("永久日常入口、零世界不空白、手机桌面与退出，导航持久化仅存空间", async ({
  page,
}) => {
  await selector(page);
  await openScripts(page);
  await expect(page.getByTestId("daily-space")).toBeVisible();
  await expect(
    page.getByTestId("daily-space").getByRole("button", { name: /删除/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("还没有剧本世界。", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "进入日常手机", exact: true }).click();
  await expect(page.locator(".desktop")).toBeVisible();
  await expect(page.locator(".chat-app")).toHaveCount(0);
  await checkSpace(page, "daily");
  await page.reload();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "daily");
  await page.getByRole("button", { name: "返回空间列表", exact: true }).click();
  await openScripts(page);
  await expect(page.getByTestId("daily-space")).toBeVisible();
  const nav = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("claudia.navigation.v1")!),
  );
  expect(nav).toEqual({ version: 1, route: { screen: "spaces" } });
});

test("世界进度按实际聊天判断，进入/退出/刷新/后退不重置、不串身份", async ({
  page,
}) => {
  await selector(page);
  const { a } = await seed(page);
  await expect(page.getByTestId("world-space-space:a/一")).toContainText(
    "已有聊天进度",
  );
  await expect(page.getByTestId("world-space-space-b")).toContainText(
    "尚无聊天进度",
  );
  await page.screenshot({ path: "artifacts/spaces-3.0.1-mobile.png" });
  const before = await page.evaluate(async () =>
    (await import("/src/store.ts")).db.messages.count(),
  );
  await page
    .getByRole("button", { name: "继续游戏 · 自定义甲", exact: true })
    .click();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space:a/一");
  // A management filter is not an authoritative space identity.
  await page.evaluate(async () =>
    (await import("/src/store.ts")).usePhone
      .getState()
      .set({ worldId: "space-b" }),
  );
  await chat(page);
  await expect(page.getByLabel("当前会话消息")).toContainText("WORLD_A_ONLY");
  await expect(page.getByLabel("当前会话消息")).not.toContainText("DAILY_ONLY");
  await leaveChat(page);
  await page
    .getByRole("button", { name: "开始游戏 · 自定义乙", exact: true })
    .click();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space-b");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space:a/一");
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space-b");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space:a/一");
  await chat(page);
  await expect(page.getByLabel("当前会话消息")).toContainText(
    "WORLD_A_ONLY_REPLY",
  );
  await leaveChat(page);
  await page.getByRole("button", { name: "进入日常手机", exact: true }).click();
  await chat(page);
  await expect(page.getByLabel("当前会话消息")).toContainText(
    "DAILY_ONLY_REPLY",
  );
  await expect(page.getByLabel("当前会话消息")).not.toContainText(
    "WORLD_A_ONLY",
  );
  expect(
    await page.evaluate(async () =>
      (await import("/src/store.ts")).db.messages.count(),
    ),
  ).toBe(before);
  expect(
    await page.evaluate(
      async (id) => (await import("/src/store.ts")).db.conversations.get(id),
      a.id,
    ),
  ).toMatchObject({ worldId: "space:a/一", mode: "world" });
});

test("复用世界 CRUD，重命名保持稳定ID，删除活动世界安全回到列表", async ({
  page,
}) => {
  await selector(page);
  await openScripts(page);
  await page
    .getByRole("button", { name: "创建 / 管理剧本", exact: true })
    .click();
  await page.getByRole("button", { name: "创建世界", exact: true }).click();
  await page.getByLabel("世界名称", { exact: true }).fill("我的新剧本");
  await page.getByLabel("世界描述", { exact: true }).fill("自定义简介");
  await page.getByRole("button", { name: "保存世界", exact: true }).click();
  await page.getByRole("button", { name: "返回空间列表", exact: true }).click();
  await openScripts(page);
  await expect(
    page.getByRole("heading", { name: "我的新剧本", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "开始游戏 · 我的新剧本", exact: true })
    .click();
  await expect(page.locator(".desktop")).toBeVisible();
  const id = await page.evaluate(
    async () =>
      (await import("/src/spaces.ts")).useSpaces.getState().space!.spaceId,
  );
  await page.getByRole("button", { name: "世界管理", exact: true }).click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("世界名称", { exact: true }).fill("重命名剧本");
  await page.getByRole("button", { name: "保存世界", exact: true }).click();
  await checkSpace(page, id);
  page.on("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "删除世界重命名剧本", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("daily-space")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "重命名剧本", exact: true }),
  ).toHaveCount(0);
});

test("无效/已删除世界及损坏导航不会误入其他空间，窄屏可触摸浏览", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("claudia.navigation.v1", "broken-json"),
  );
  await selector(page);
  await page.goto("/#phone/world/nonexistent");
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("该世界已不存在", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      async () => (await import("/src/spaces.ts")).useSpaces.getState().space,
    ),
  ).toBeNull();
  await seed(page);
  for (const width of [320, 390, 844]) {
    await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
    expect(
      await page
        .locator(".space-selection")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
});

test("生成中切换空间取消旧请求，迟到响应不写入新空间，保留旧用户消息", async ({
  page,
}) => {
  await selector(page);
  const { a, b } = await seed(page);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const payloads: any[] = [];
  await page.route("https://space.example.test/**", async (route) => {
    const body = route.request().postDataJSON();
    payloads.push(body);
    const old = JSON.stringify(body).includes("甲待回复");
    if (old) await gate;
    await route
      .fulfill({
        json: {
          choices: [
            { message: { content: old ? "甲迟到响应" : "乙正常回复" } },
          ],
        },
      })
      .catch(() => {});
  });
  await page
    .getByRole("button", { name: "继续游戏 · 自定义甲", exact: true })
    .click();
  await chat(page);
  await page.getByLabel("聊天消息", { exact: true }).fill("甲待回复");
  const request = page.waitForRequest(
    "https://space.example.test/v1/chat/completions",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await request;
  await leaveChat(page);
  await page
    .getByRole("button", { name: "开始游戏 · 自定义乙", exact: true })
    .click();
  await chat(page);
  await expect(page.getByLabel("当前会话消息")).not.toContainText(
    "WORLD_A_ONLY",
  );
  await page.getByLabel("聊天消息", { exact: true }).fill("乙的新消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("当前会话消息")).toContainText("乙正常回复");
  release();
  await expect
    .poll(() =>
      page.evaluate(
        async (id) =>
          (await import("/src/store.ts")).db.conversations
            .get(id)
            .then((c) => c?.sendingToken),
        a.id,
      ),
    )
    .toBeUndefined();
  const stored = await page.evaluate(
    async ({ a, b }) => {
      const { db } = await import("/src/store.ts");
      return {
        a: await db.messages.where("conversationId").equals(a.id).toArray(),
        b: await db.messages
          .where("conversationId")
          .equals(b.id)
          .sortBy("createdAt"),
        version: db.verno,
      };
    },
    { a, b },
  );
  expect(stored.a.some((m) => m.content === "甲待回复")).toBe(true);
  expect(stored.a.some((m) => m.content === "甲迟到响应")).toBe(false);
  expect(stored.b.map((m) => m.content)).toEqual(["乙的新消息", "乙正常回复"]);
  expect(JSON.stringify(payloads.at(-1))).not.toContain("WORLD_A_ONLY");
  expect(JSON.stringify(payloads.at(-1))).not.toContain("DAILY_ONLY");
  expect(stored.version).toBe(5);
  await checkSpace(page, "world:space-b");
});

test("导航保存失败仍可进入空间，原世界聊天和API凭据不变", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "QuotaExceededError");
    };
  });
  await selector(page);
  const { a } = await seed(page);
  await expect(page.getByRole("alert")).toContainText("空间导航无法保存");
  await page
    .getByRole("button", { name: "继续游戏 · 自定义甲", exact: true })
    .click();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space:a/一");
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import("/src/store.ts");
      return {
        messages: await db.messages.where("conversationId").equals(id).count(),
        key: (await db.apiCredentials.get("space-api"))!.apiKey,
      };
    }, a.id),
  ).toEqual({ messages: 2, key: "synthetic-space-key" });
  await page.getByRole("button", { name: "返回空间列表", exact: true }).click();
  await openScripts(page);
  await expect(page.getByTestId("daily-space")).toBeVisible();
});

test("历史写入失败不产生身份/URL错位，快速切换只激活最后一个目的地", async ({
  page,
}) => {
  await selector(page);
  await seed(page);
  await page.evaluate(() => {
    (window as any).__pushState = history.pushState;
    history.pushState = () => {
      throw new DOMException("Blocked", "SecurityError");
    };
  });
  await page
    .getByRole("button", { name: "继续游戏 · 自定义甲", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "选择空间", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("未切换空间");
  expect(
    await page.evaluate(
      async () => (await import("/src/spaces.ts")).useSpaces.getState().space,
    ),
  ).toBeNull();
  expect(new URL(page.url()).hash).toBe("#spaces");
  await page.evaluate(async () => {
    history.pushState = (window as any).__pushState;
    const { useSpaces } = await import("/src/spaces.ts");
    await Promise.all([
      useSpaces.getState().enterSpace("world:space:a/一"),
      useSpaces.getState().enterSpace("world:space-b"),
    ]);
  });
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space-b");
  expect(new URL(page.url()).hash).toBe("#phone/world/space-b");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("日常角色管理默认基础角色不自动关联首世界，世界入口仍选中对应世界", async ({
  page,
}) => {
  await selector(page);
  await seed(page);
  await page.getByRole("button", { name: "进入日常手机", exact: true }).click();
  await page.getByRole("button", { name: "角色管理", exact: true }).click();
  await expect(page.getByLabel("当前世界", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "创建角色", exact: true }).click();
  await page.getByLabel("角色姓名", { exact: true }).fill("日常新增角色");
  await page.getByRole("button", { name: "保存角色", exact: true }).click();
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      const c = await db.characters
        .filter((c) => c.name === "日常新增角色")
        .first();
      return c
        ? await db.worldProfiles.where("characterId").equals(c.id).count()
        : -1;
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "返回空间列表", exact: true }).click();
  await openScripts(page);
  await page
    .getByRole("button", { name: "继续游戏 · 自定义甲", exact: true })
    .click();
  await page.getByRole("button", { name: "角色管理", exact: true }).click();
  await expect(page.getByLabel("当前世界", { exact: true })).toHaveValue(
    "space:a/一",
  );
});
