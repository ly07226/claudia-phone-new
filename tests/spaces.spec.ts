import { test, expect, type Page } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
async function openScripts(page: Page) {
  await expect(page.getByRole("heading", { name: /^(选择空间|剧本世界)$/ })).toBeVisible();
  const entry = page.getByRole("button", { name: "剧本", exact: true });
  if (await entry.count()) await entry.click();
  await expect(page.getByRole("heading", {name:"剧本世界",exact:true})).toBeVisible();
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
    page.getByRole("heading", { name: "剧本世界", exact: true }),
  ).toBeVisible();
}

test("永久日常入口、零世界不空白、手机桌面与退出，导航持久化仅存空间", async ({page}) => {
  await selector(page);
  await expect(page.getByTestId("daily-space")).toBeVisible();
  await page.getByRole("button",{name:"进入日常手机",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page,"daily");
  await page.reload(); await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page,"daily");
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();
  await expect(page.getByTestId("daily-space")).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("claudia.navigation.v1")!))).toEqual({version:1,route:{screen:"spaces"}});
  await openScripts(page);
  await expect(page.getByTestId("daily-space")).toHaveCount(0);
  await expect(page.getByText("暂无剧本",{exact:true})).toBeVisible();
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
    .getByRole("button", { name: "开始新游戏 · 自定义乙", exact: true })
    .click();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space-b");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "剧本世界", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space:a/一");
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "剧本世界", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.locator(".desktop")).toBeVisible();
  await checkSpace(page, "world:space-b");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "剧本世界", exact: true }),
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
  await page.getByRole("button", {name:"返回空间首页",exact:true}).click();
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
  await page.getByRole("button", { name: "新建剧本", exact: true }).click();
  await page.getByRole("button", {name:"手动粘贴", exact:true}).click();
  await page.getByLabel("世界名称", { exact: true }).fill("我的新剧本");
  await page.getByLabel("世界描述", { exact: true }).fill("自定义简介");
  await page.getByRole("button", { name: "保存世界", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的新剧本", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "开始新游戏 · 我的新剧本", exact: true })
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
    .getByRole("button", { name: "开始新游戏 · 自定义乙", exact: true })
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
  expect(stored.version).toBe(6);
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
  await expect(page.getByTestId("daily-space")).toHaveCount(0);
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
    page.getByRole("heading", { name: "剧本世界", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("未切换空间");
  expect(
    await page.evaluate(
      async () => (await import("/src/spaces.ts")).useSpaces.getState().space,
    ),
  ).toBeNull();
  expect(new URL(page.url()).hash).toBe("#worlds");
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
  await page.getByRole("button", {name:"返回空间首页",exact:true}).click();
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

for (const standalone of [false, true]) test(`三级路由、刷新/后退及真实存档入口保留全部数据：standalone=${standalone}`, async ({ page }) => {
  if (standalone) await page.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = original(query);
      if (query.includes("display-mode: standalone")) Object.defineProperty(result, "matches", {value:true});
      return result;
    };
  });
  await selector(page);
  const { a } = await seed(page);
  await page.evaluate(async id => {
    const { db } = await import("/src/store.ts");
    await db.conversationSnapshots.put({id:"navigation-snapshot",conversationId:id,reason:"edit",createdAt:1,
      messages:await db.messages.where("conversationId").equals(id).toArray(),
      variants:await db.messageVariants.where("conversationId").equals(id).toArray()});
  }, a.id);
  const capture = () => page.evaluate(async () => {
    const {db} = await import("/src/store.ts");
    return db.transaction("r",db.tables,async()=>Object.fromEntries(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()]))));
  });
  const before = await capture();
  expect(new URL(page.url()).hash).toBe("#worlds");
  await expect(page.getByTestId("daily-space")).toHaveCount(0);
  await expect(page.locator(".space-mascot")).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"选择空间",exact:true})).toHaveCount(0);
  const card = page.getByTestId("world-space-space:a/一");
  await expect(card.getByRole("button",{name:"继续游戏 · 自定义甲",exact:true})).toBeVisible();
  await expect(card.getByRole("button",{name:"开始新游戏",exact:true})).toHaveCount(0);
  expect(await capture()).toEqual(before);
  await card.getByRole("button",{name:"存档管理 · 自定义甲",exact:true}).click();
  await expect(card.getByRole("region",{name:"存档管理"})).toContainText("2 条消息 · 1 个历史快照");
  await expect(card.getByRole("region",{name:"存档管理"})).toContainText("不提供独立存档槽");
  await page.reload();
  await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"开始新游戏 · 自定义乙",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,"world:space-b");
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();
  await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"继续游戏 · 自定义甲",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,"world:space:a/一");
  await page.reload(); await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,"world:space:a/一");
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();
  await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  await page.goBack(); await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,"world:space:a/一");
  await page.goForward(); await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"返回空间首页",exact:true}).click();
  await expect(page.locator(".space-mascot img")).toBeVisible();
  await page.getByRole("button",{name:"进入日常手机",exact:true}).click();
  await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,"daily");
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();
  await expect(page.getByRole("heading",{name:"选择空间",exact:true})).toBeVisible();
  expect(await capture()).toEqual(before);
});

test("新建入口默认折叠，AI仅提示无写入或请求，手动粘贴复用保存，卡片直达手机", async ({page}) => {
  await selector(page); await openScripts(page);
  await expect(page.getByText("暂无剧本",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"手动粘贴",exact:true})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"AI 生成",exact:true})).toHaveCount(0);
  const capture = () => page.evaluate(async () => {
    const {db} = await import("/src/store.ts");
    return db.transaction("r",db.tables,async()=>Object.fromEntries(await Promise.all(db.tables.map(async t=>[t.name,await t.toArray()]))));
  });
  const before = await capture();
  let posts = 0; page.on("request", r=>{if(r.method()==="POST") posts++;});
  await page.getByRole("button",{name:"新建剧本",exact:true}).click();
  await expect(page.getByRole("button",{name:"手动粘贴",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"AI 生成",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("AI 剧本生成器即将开放");
  expect(await capture()).toEqual(before); expect(posts).toBe(0);
  await page.getByRole("button",{name:"手动粘贴",exact:true}).click();
  await page.getByLabel("世界名称",{exact:true}).fill("我的粘贴剧本");
  await page.getByLabel("世界背景",{exact:true}).fill("原始剧情第一行\n第二行：保留标点。");
  expect(await capture()).toEqual(before);
  await page.getByRole("button",{name:"保存世界",exact:true}).click();
  const world = await page.evaluate(async()=> (await import("/src/store.ts")).db.worlds.toArray());
  expect(world).toHaveLength(1); expect(world[0].background).toBe("原始剧情第一行\n第二行：保留标点。");
  const card=page.getByTestId(`world-space-${world[0].id}`);
  await card.locator(".space-description").click();
  await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,`world:${world[0].id}`);
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();
  await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"手动粘贴",exact:true})).toHaveCount(0);
  await page.evaluate(async id=>{const {db,usePhone}=await import("/src/store.ts");await db.worlds.update(id,{cover:"legacy-cover",extraInfo:{note:"keep"}} as any); await usePhone.getState().reload();},world[0].id);
  await card.locator("summary").click();
  await card.getByRole("button",{name:"编辑",exact:true}).click();
  await page.getByLabel("世界名称",{exact:true}).fill("修改名字");
  await page.getByRole("button",{name:"保存世界",exact:true}).click();
  expect(await page.evaluate(async id=>(await import("/src/store.ts")).db.worlds.get(id),world[0].id)).toMatchObject({id:world[0].id,name:"修改名字",cover:"legacy-cover",extraInfo:{note:"keep"}});
  await page.getByRole("button",{name:"进入剧本 · 修改名字",exact:true}).focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".desktop")).toBeVisible(); await checkSpace(page,`world:${world[0].id}`);
});

test("独立创建子页逐级返回、取消无写入，紧凑卡片与更多操作不串导航", async ({page}) => {
  await selector(page); const {a}=await seed(page);
  const before=await page.evaluate(async()=>{const {db}=await import("/src/store.ts");return {worlds:await db.worlds.toArray(),messages:await db.messages.toArray(),profiles:await db.worldProfiles.toArray()};});
  await expect(page.locator("form")).toHaveCount(0);
  await page.getByRole("button",{name:"新建剧本",exact:true}).click();
  expect(new URL(page.url()).hash).toBe("#worlds/create");
  await expect(page.locator(".script-compact")).toHaveCount(0); await expect(page.locator("form")).toHaveCount(0);
  await page.getByRole("button",{name:"手动粘贴",exact:true}).click();
  expect(new URL(page.url()).hash).toBe("#worlds/create/manual");
  await expect(page.locator(".script-compact")).toHaveCount(0);
  await page.getByLabel("世界名称",{exact:true}).fill("不会保存的草稿");
  await page.getByRole("button",{name:"取消",exact:true}).click();
  await expect(page.getByRole("button",{name:"手动粘贴",exact:true})).toBeVisible();
  await page.reload(); await expect(page.getByRole("button",{name:"手动粘贴",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"手动粘贴",exact:true}).click();
  await page.goBack(); await expect(page.getByRole("button",{name:"AI 生成",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"返回剧本列表",exact:true}).click();
  await expect(page.locator("form")).toHaveCount(0);
  const card=page.getByTestId("world-space-space:a/一");
  for (const width of [320,390,430]) {
    await page.setViewportSize({width,height:844});
    const layout=await card.evaluate(el=>{const card=el.getBoundingClientRect(),info=el.querySelector(".script-card-info")!.getBoundingClientRect(),actions=el.querySelector(".script-card-actions")!.getBoundingClientRect();return {height:card.height,aligned:actions.left>info.right,overflow:document.documentElement.scrollWidth>innerWidth};});
    expect(layout.height).toBeLessThanOrEqual(220);expect(layout.aligned).toBe(true);expect(layout.overflow).toBe(false);
  }
  await card.locator("summary").click();
  await expect(card.getByRole("button",{name:"查看角色",exact:true})).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#worlds");
  const menu=await card.locator(".script-more-popup").boundingBox();expect(menu!.x).toBeGreaterThanOrEqual(0);
  await card.getByRole("button",{name:"编辑",exact:true}).click();
  expect(new URL(page.url()).hash).toBe("#worlds/edit/space%3Aa%2F%E4%B8%80");
  await expect(page.locator(".script-compact")).toHaveCount(0);
  await page.getByRole("button",{name:"取消",exact:true}).click();
  await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  let confirms=0;const dismiss=(d:any)=>{confirms++;void d.dismiss();};page.on("dialog",dismiss);
  await card.locator("summary").click();await card.getByRole("button",{name:"删除世界自定义甲",exact:true}).click();
  expect(confirms).toBe(1);expect(new URL(page.url()).hash).toBe("#worlds");page.off("dialog",dismiss);
  await card.getByRole("button",{name:"查看角色",exact:true}).click();
  await expect(page.getByRole("heading",{name:"角色管理",exact:true})).toBeVisible();await checkSpace(page,"world:space:a/一");
  await page.getByRole("button",{name:"返回空间列表",exact:true}).click();await expect(page.getByRole("heading",{name:"剧本世界",exact:true})).toBeVisible();
  expect(await page.evaluate(async()=>{const {db}=await import("/src/store.ts");return {worlds:await db.worlds.toArray(),messages:await db.messages.toArray(),profiles:await db.worldProfiles.toArray()};})).toEqual(before);
  expect(await page.evaluate(async id=>(await import("/src/store.ts")).db.conversations.get(id),a.id)).toBeTruthy();
  await page.screenshot({path:"artifacts/script-compact-mobile.png"});
});
