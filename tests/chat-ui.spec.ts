import { test, expect } from "@playwright/test";
async function setup(
  page: any,
  count = 2,
  name = "当前角色的超长名字用于验证标题居中与省略显示",
) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  return page.evaluate(
    async ({ count, name }) => {
      const { db } = await import("/src/store.ts");
      const { getConversation } = await import("/src/chatService.ts");
      await db.characters.bulkPut([
        { id: "ui-c1", name, persona: "base", avatar: "ui-avatar" },
        { id: "ui-c2", name: "另一个世界角色", persona: "other" },
      ]);
      await db.assets.put({
        id: "ui-avatar",
        type: "avatar",
        data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        createdAt: 1,
      });
      await db.worlds.bulkPut([
        { id: "ui-w1", name: "用户世界一", description: "one", createdAt: 1 },
        { id: "ui-w2", name: "用户世界二", description: "two", createdAt: 1 },
      ]);
      await db.worldProfiles.bulkPut([
        { id: "ui-p1", worldId: "ui-w1", characterId: "ui-c1", setting: "" },
        { id: "ui-p2", worldId: "ui-w2", characterId: "ui-c2", setting: "" },
      ]);
      await db.apiConfigs.bulkPut([
        {
          id: "ui-api",
          name: "默认连接",
          provider: "openai-compatible",
          baseUrl: "https://ui.example.test/v1",
          model: "model-one",
          temperature: 0.7,
          maxTokens: 100,
          enabled: true,
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "ui-api2",
          name: "会话专用连接",
          provider: "openai-compatible",
          baseUrl: "https://ui.example.test/v1",
          model: "model-two",
          temperature: 0.5,
          maxTokens: 100,
          enabled: true,
          isDefault: false,
          createdAt: 1,
          updatedAt: 1,
        },
      ]);
      await db.apiCredentials.bulkPut([
        { configId: "ui-api", apiKey: "synthetic-ui-key" },
        { configId: "ui-api2", apiKey: "synthetic-ui-key-2" },
      ]);
      const daily = await getConversation("ui-c1");
      const world1 = await getConversation("ui-c1", "ui-w1");
      const world2 = await getConversation("ui-c2", "ui-w2");
      for (const conv of [daily, world1, world2])
        for (let i = 0; i < count; i++) {
          const id = `${conv.id}-${i}`;
          await db.messages.put({
            id,
            conversationId: conv.id,
            role: i % 2 ? "assistant" : "user",
            content:
              `消息 ${i} ` +
              (i === 1 ? "verylong".repeat(65) : "用户自定义文字。".repeat(8)),
            createdAt: i + 1,
            ...(i % 2 ? { activeVariantId: `variant-${id}` } : {}),
          });
          if (i % 2)
            await db.messageVariants.put({
              id: `variant-${id}`,
              conversationId: conv.id,
              messageId: id,
              content:
                `消息 ${i} ` +
                (i === 1
                  ? "verylong".repeat(65)
                  : "用户自定义文字。".repeat(8)),
              source: "legacy",
              createdAt: 1,
            });
        }
      return { daily, world1, world2, name };
    },
    { count, name },
  );
}
async function daily(page: any, name: string) {
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}
test("沉浸导航名称居中、无顶部头像和状态说明、左右头像及桌面恢复", async ({
  page,
}) => {
  const state = await setup(page);
  await daily(page, state.name);
  const nav = page.getByRole("navigation", { name: "当前会话导航" });
  await expect(nav.getByRole("heading")).toHaveText(state.name);
  await expect(nav.locator("img,.chat-avatar")).toHaveCount(0);
  await expect(page.locator(".status")).toBeHidden();
  await expect(page.locator(".app-panel>header")).toBeHidden();
  await expect(page.locator(".chat-space")).toHaveCount(0);
  await expect(page.getByLabel("本会话 API", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "历史快照 / 分支恢复" }),
  ).toHaveCount(0);
  const boxes = await nav.evaluate((el) => {
    const n = el.getBoundingClientRect();
    const title = el.querySelector(".chat-nav-title")!.getBoundingClientRect();
    return {
      mid: n.x + n.width / 2,
      title: title.x + title.width / 2,
      white: getComputedStyle(el.querySelector(".chat-nav-title")!).whiteSpace,
    };
  });
  expect(Math.abs(boxes.mid - boxes.title)).toBeLessThan(1);
  expect(boxes.white).toBe("nowrap");
  const ai = page.locator(".chat-message-row-assistant");
  expect(
    await ai
      .locator(".chat-bubble")
      .evaluate((el) => getComputedStyle(el).touchAction),
  ).toContain("pinch-zoom");
  await expect(ai.locator(".chat-avatar img")).toHaveCount(1);
  await expect(ai.locator(".chat-avatar img")).toHaveJSProperty(
    "complete",
    true,
  );
  await ai.locator(".chat-avatar img").dispatchEvent("error");
  await expect(ai.locator(".chat-avatar img")).toHaveCount(0);
  await expect(ai.locator(".chat-avatar-character")).toContainText(
    state.name.slice(0, 1),
  );
  const user = page.locator(".chat-message-row-user");
  await expect(user.locator(".chat-avatar-user")).toHaveCount(1);
  expect(
    await ai.evaluate((el) => {
      const a = el.querySelector(".chat-avatar")!.getBoundingClientRect();
      const b = el.querySelector(".chat-bubble")!.getBoundingClientRect();
      return a.right <= b.left;
    }),
  ).toBe(true);
  expect(
    await user.evaluate((el) => {
      const a = el.querySelector(".chat-avatar")!.getBoundingClientRect();
      const b = el.querySelector(".chat-bubble")!.getBoundingClientRect();
      return a.left >= b.right;
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "返回角色列表" }).click();
  await expect(page.locator(".status")).toBeVisible();
  await page.getByRole("button", { name: "返回桌面" }).click();
  await expect(page.locator(".desktop")).toBeVisible();
  await expect(page.locator(".status")).toBeVisible();
});
test("World 正确角色与回退名称头像，会话说明只在菜单展示", async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { usePhone } = await import("/src/store.ts");
    await usePhone.getState().reload();
    const { useSpaces } = await import("/src/spaces.ts");
    await useSpaces.getState().enterSpace("world:ui-w2");
    usePhone.getState().set({ activeApp: "世界聊天", worldId: "ui-w2" });
  });
  await page.getByRole("button", { name: /另一个世界角色.*开始/ }).click();
  await expect(page.locator(".chat-nav-title")).toHaveText("另一个世界角色");
  await expect(
    page.locator(".chat-message-row-assistant .chat-avatar-character img"),
  ).toHaveCount(0);
  await expect(
    page.locator(".chat-message-row-assistant .chat-avatar-character"),
  ).toContainText("另");
  await page.getByRole("button", { name: "会话管理", exact: true }).click();
  await page.getByRole("button", { name: "会话信息", exact: true }).click();
  await expect(page.locator(".chat-settings-page")).toContainText("世界聊天 · 用户世界二");
  await expect(page.locator(".chat-settings-page")).not.toContainText("用户世界一");
  await page.keyboard.press("Escape");
  await expect(page.locator(".chat-settings-page")).toHaveCount(0);
  const names = await page.evaluate(async () => {
    const { chatDisplayName } = await import("/src/chatPresentation.ts");
    return [
      chatDisplayName(),
      chatDisplayName({ id: "x", name: " ", persona: "" }),
      chatDisplayName({ id: "x", name: "原名", persona: "" }),
    ];
  });
  expect(names).toEqual(["未命名角色", "未命名角色", "原名"]);
  await page.evaluate(async () => {
    const { db, usePhone } = await import("/src/store.ts");
    await db.characters.update("ui-c2", { name: " " });
    await usePhone.getState().reload();
  });
  await expect(page.locator(".chat-nav-title")).toHaveText("未命名角色");
});
test("管理菜单、会话 API 选择与真实连接测试、快照入口和删除二次确认", async ({
  page,
}) => {
  const state = await setup(page);
  await daily(page, state.name);
  let body: any;
  await page.route("https://ui.example.test/**", (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({ json: { choices: [{ message: { content: "ok" } }] } });
  });
  await page.getByRole("button", { name: "会话管理", exact: true }).click();
  await page.getByRole("button", { name: "会话信息", exact: true }).click();
  await expect(page.locator(".chat-settings-page")).toContainText("日常聊天 · 独立空间");
  await page.getByRole("button", { name: "返回管理菜单" }).click();
  await page
    .getByRole("button", { name: "本会话 API 配置", exact: true })
    .click();
  await page.getByLabel("本会话 API", { exact: true }).selectOption("ui-api2");
  await page.getByRole("button", { name: "API 连接测试", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("连接成功");
  expect(body.model).toBe("model-two");
  expect(body.max_tokens).toBe(1);
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import("/src/store.ts");
      return (await db.conversations.get(id))?.apiConfigId;
    }, state.daily.id),
  ).toBe("ui-api2");
  await page.getByRole("button", { name: "返回管理菜单" }).click();
  await page.getByRole("button", { name: "历史快照 / 分支恢复" }).click();
  await expect(page.getByRole("dialog")).toHaveAttribute(
    "aria-label",
    "可恢复的历史快照",
  );
  await page.getByRole("button", { name: "关闭消息面板" }).click();
  await page.getByRole("button", { name: "会话管理", exact: true }).click();
  let count = 0;
  const handler = (d: any) => {
    count++;
    void (count === 2 ? d.dismiss() : d.accept());
  };
  page.on("dialog", handler);
  await page.getByRole("button", { name: "删除会话", exact: true }).click();
  expect(count).toBe(2);
  await expect(page.locator(".chat-nav-title")).toHaveText(state.name);
  expect(
    await page.evaluate(async (id) => {
      const { db } = await import("/src/store.ts");
      return !!(await db.conversations.get(id));
    }, state.daily.id),
  ).toBe(true);
  page.off("dialog", handler);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除会话", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "聊天", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return db.conversations.count();
    }),
  ).toBe(2);
});
test("消息唯一主滚动容器、输入自增高、末条不遮挡、窄屏和横竖屏视口", async ({
  page,
}) => {
  const state = await setup(page, 30, "视口测试角色");
  await daily(page, state.name);
  const history = page.getByLabel("当前会话消息");
  const input = page.getByLabel("聊天消息", { exact: true });
  const initial = await input.boundingBox();
  await input.fill("多行文字\n".repeat(20));
  expect((await input.boundingBox())!.height).toBeGreaterThan(initial!.height);
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(121);
  await input.fill("");
  expect((await input.boundingBox())!.height).toBeLessThanOrEqual(42);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 350 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(100);
    const rects = await page.evaluate(() => {
      const history = document.querySelector(".chat-history")!,
        nav = document.querySelector(".chat-nav")!,
        footer = document.querySelector(".chat-footer")!,
        app = document.querySelector(".app-scroll")!;
      const h = history.getBoundingClientRect(),
        n = nav.getBoundingClientRect(),
        f = footer.getBoundingClientRect();
      return {
        navTop: n.top,
        historyBottom: h.bottom,
        footerTop: f.top,
        footerBottom: f.bottom,
        height: innerHeight,
        scroll: getComputedStyle(history).overflowY,
        outerOverflow: getComputedStyle(app).overflowY,
        hScroll: history.scrollHeight > history.clientHeight,
        overflow:
          document.querySelector(".chat-immersive")!.scrollWidth >
          document.querySelector(".chat-immersive")!.clientWidth,
        ratio: h.height / innerHeight,
      };
    });
    expect(rects.navTop).toBeGreaterThanOrEqual(0);
    expect(rects.historyBottom).toBeLessThanOrEqual(rects.footerTop + 1);
    expect(rects.footerBottom).toBeLessThanOrEqual(rects.height + 1);
    expect(rects.scroll).toBe("auto");
    expect(rects.outerOverflow).toBe("hidden");
    expect(rects.hScroll).toBe(true);
    expect(rects.overflow).toBe(false);
    expect(rects.ratio).toBeGreaterThan(0.5);
  }
  await history.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const last = page.locator(".chat-message-row").last();
  const lastBox = (await last.boundingBox())!,
    footer = (await page.locator(".chat-footer").boundingBox())!;
  expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(footer.y + 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "artifacts/chat-2.3.4-mobile.png" });
});
test("浏览历史时回复不强制滚底，多版本切换保持位置，菜单在缩小视口可用", async ({
  page,
}) => {
  const state = await setup(page, 40, "滚动测试");
  await page.evaluate(async (id) => {
    const { db } = await import("/src/store.ts");
    const ai = (
      await db.messages.where("conversationId").equals(id).sortBy("createdAt")
    ).at(-1)!;
    await db.messageVariants.add({
      id: "alternate-ui",
      conversationId: id,
      messageId: ai.id,
      source: "generated",
      content: ai.content.replace("消息", "版本"),
      createdAt: 2,
    });
  }, state.daily.id);
  await daily(page, state.name);
  await expect
    .poll(() =>
      page
        .getByLabel("当前会话消息")
        .evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
    )
    .toBeLessThanOrEqual(1);
  const beforeSwitch = await page
    .getByLabel("当前会话消息")
    .evaluate((el) => el.scrollTop);
  await page
    .locator(".chat-assistant")
    .last()
    .getByRole("button", { name: "下一个回复版本" })
    .click();
  await expect(page.locator(".chat-assistant").last()).toContainText("版本");
  expect(
    Math.abs(
      (await page.getByLabel("当前会话消息").evaluate((el) => el.scrollTop)) -
        beforeSwitch,
    ),
  ).toBeLessThanOrEqual(1);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("https://ui.example.test/**", async (r) => {
    await gate;
    await r.fulfill({
      json: { choices: [{ message: { content: "新增回复" } }] },
    });
  });
  await page.getByLabel("聊天消息").fill("新的消息");
  const request = page.waitForRequest(
    "https://ui.example.test/v1/chat/completions",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await request;
  const history = page.getByLabel("当前会话消息");
  await history.evaluate((el) => {
    el.scrollTop = 20;
    el.dispatchEvent(new Event("scroll"));
  });
  release();
  await expect(page.locator(".chat-assistant").last()).toContainText(
    "新增回复",
  );
  expect(await history.evaluate((el) => el.scrollTop)).toBeLessThan(100);
  await page.getByRole("button", { name: "会话管理", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 330 });
  await expect(page.locator(".chat-settings-page")).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(page.locator(".chat-settings-page")).toHaveCount(0);
});
test("消息编辑面板缩小视口仍可保存取消，生成中返回不会污染新角色界面", async ({
  page,
}) => {
  const state = await setup(page, 2, "导航测试角色");
  await daily(page, state.name);
  await page
    .locator(".chat-assistant")
    .getByRole("button", { name: /消息操作/ })
    .press("Enter");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 330 });
  await page.getByLabel("编辑消息内容").fill("长文本\n".repeat(80));
  const save = page.getByRole("button", { name: "仅保存修改" }),
    cancel = page.getByRole("button", { name: "取消", exact: true });
  await expect(save).toBeInViewport();
  await expect(cancel).toBeInViewport();
  await cancel.click();
  await page.setViewportSize({ width: 390, height: 844 });
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("https://ui.example.test/**", async (r) => {
    await gate;
    await r
      .fulfill({
        json: { choices: [{ message: { content: "旧角色迟到回复" } }] },
      })
      .catch(() => {});
  });
  await page.getByLabel("聊天消息").fill("返回前发送");
  const request = page.waitForRequest(
    "https://ui.example.test/v1/chat/completions",
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await request;
  await page.getByRole("button", { name: "返回角色列表" }).click();
  await page.getByRole("button", { name: /另一个世界角色.*开始/ }).click();
  await expect(page.locator(".chat-nav-title")).toHaveText("另一个世界角色");
  release();
  await page.waitForTimeout(150);
  await expect(page.locator(".chat-bubble")).toHaveCount(0);
  await expect(page.getByLabel("聊天消息")).toBeEnabled();
  expect(
    await page.evaluate(async (id) => {
      const { activeMessages } = await import("/src/messagePath.ts");
      return (await activeMessages(id)).at(-1)?.content;
    }, state.daily.id),
  ).toBe("返回前发送");
});
