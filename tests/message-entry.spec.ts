import { test, expect, type Page } from "@playwright/test";
const original = "第一段原文。\n第二段原文。\n第三段原文。";
async function open(page: Page, world = false) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (content) => {
    const { db } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    await db.characters.put({
      id: "entry-char",
      name: "入口角色",
      persona: "",
    });
    await db.worlds.put({
      id: "entry-world",
      name: "用户自定义世界",
      description: "",
      createdAt: 1,
    });
    await db.worldProfiles.put({
      id: "entry-profile",
      worldId: "entry-world",
      characterId: "entry-char",
      setting: "",
    });
    for (const conv of [
      await getConversation("entry-char"),
      await getConversation("entry-char", "entry-world"),
    ]) {
      await db.messages.bulkPut([
        {
          id: `${conv.id}-user`,
          conversationId: conv.id,
          role: "user",
          content: "用户原文。",
          createdAt: 1,
        },
        {
          id: `${conv.id}-ai`,
          conversationId: conv.id,
          role: "assistant",
          content,
          activeVariantId: `${conv.id}-v1`,
          createdAt: 2,
        },
      ]);
      await db.messageVariants.bulkPut([
        {
          id: `${conv.id}-v1`,
          conversationId: conv.id,
          messageId: `${conv.id}-ai`,
          content,
          source: "legacy",
          createdAt: 1,
        },
        {
          id: `${conv.id}-v2`,
          conversationId: conv.id,
          messageId: `${conv.id}-ai`,
          content: "第二版本。\n另一气泡。",
          source: "generated",
          createdAt: 2,
        },
      ]);
    }
  }, original);
  await page.reload();
  // Let the saved daily startup finish before bypassing UI through the navigation store.
  await expect(page.locator(".desktop")).toBeVisible();
  if (world)
    await page.evaluate(async () => {
      const { usePhone } = await import("/src/store.ts");
      const { useSpaces } = await import("/src/spaces.ts");
      await useSpaces.getState().enterSpace("world:entry-world");
      usePhone
        .getState()
        .set({ activeApp: "世界聊天", worldId: "entry-world" });
    });
  else await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /入口角色.*开始/ }).click();
  await expect(
    page.locator(".chat-assistant .chat-bubble-surface"),
  ).toHaveCount(3);
}
async function pressBubble(page: Page, selector: string, index = 0) {
  const bubble = page.locator(selector).nth(index);
  await bubble.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX: 90,
    clientY: 200,
  });
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await bubble.dispatchEvent("pointerup", { pointerId: 1 });
}

test("Daily/World 无气泡名称、常显按钮和顶部占位，导航头像保留", async ({
  page,
}) => {
  for (const world of [false, true]) {
    await open(page, world);
    await expect(page.locator(".chat-nav-title")).toHaveText("入口角色");
    await expect(page.locator(".chat-message-row .chat-avatar")).toHaveCount(2);
    await expect(
      page.locator(".chat-bubble .message-top,.chat-bubble small"),
    ).toHaveCount(0);
    await expect(page.locator(".chat-bubble-surface button")).toHaveCount(0);
    const metrics = await page.locator(".chat-bubble").evaluateAll((nodes) =>
      nodes.map((el) => {
        const button = el.querySelector(".message-access")!;
        const css = getComputedStyle(button);
        const p = el.querySelector(".chat-bubble-surface p")!;
        const surface = p.parentElement!;
        return {
          position: css.position,
          clip: css.clipPath,
          width: button.getBoundingClientRect().width,
          children: [...surface.children].map((c) => c.tagName),
          select: getComputedStyle(p).webkitUserSelect,
          gap:
            p.getBoundingClientRect().top - surface.getBoundingClientRect().top,
        };
      }),
    );
    for (const m of metrics) {
      expect(m.position).toBe("absolute");
      expect(m.clip).toBe("inset(50%)");
      expect(m.width).toBe(1);
      expect(m.children).toEqual(["P"]);
      expect(m.select).toBe("none");
      expect(m.gap).toBeLessThanOrEqual(6); // Only existing bubble padding; no old 28px header.
    }
  }
});

test("长按任意 AI 子气泡及用户气泡，500ms、菜单内容与原文一致", async ({
  page,
}) => {
  await open(page);
  const ai = ".chat-assistant .chat-bubble-surface";
  const first = page.locator(ai).first();
  await first.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX: 90,
    clientY: 200,
  });
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await first.dispatchEvent("pointerup", { pointerId: 1 });
  await page.keyboard.press("Escape");
  for (let i = 0; i < 3; i++) {
    await pressBubble(page, ai, i);
    for (const name of ["复制", "编辑", "重新生成", "删除"])
      await expect(
        page.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByLabel("编辑消息内容")).toHaveValue(original);
    await page.getByRole("button", { name: "取消", exact: true }).click();
  }
  // Clipboard permissions can be denied on Safari; the original selectable fallback remains.
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Permission denied");
        },
      },
    });
  });
  await pressBubble(page, ai, 2);
  await page.getByRole("button", { name: "复制", exact: true }).click();
  const fallback = page.getByLabel("可手动复制的消息文本");
  await expect(fallback).toHaveValue(original);
  expect(
    await fallback.evaluate((el) => {
      const input = el as HTMLTextAreaElement;
      input.select();
      return input.selectionEnd - input.selectionStart;
    }),
  ).toBe(original.length);
  expect(
    await fallback.evaluate((el) => getComputedStyle(el).userSelect),
  ).not.toBe("none");
  await page.keyboard.press("Escape");
  await pressBubble(page, ".chat-user .chat-bubble-surface");
  for (const name of ["引用回复", "复制", "编辑", "删除"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "重新生成", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button",{name:"编辑",exact:true}).click();
  await expect(page.getByRole("button",{name:"撤回",exact:true})).toBeVisible();
  await page.locator(".message-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("移动、滚动、取消和短按不打开菜单；原生 contextmenu 被取消", async ({
  page,
}) => {
  await open(page);
  const bubble = page.locator(".chat-assistant .chat-bubble-surface").last();
  for (const cancel of ["move", "scroll", "cancel", "up"]) {
    await bubble.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "touch",
      button: 0,
      clientX: 90,
      clientY: 200,
    });
    if (cancel === "move")
      await bubble.dispatchEvent("pointermove", {
        pointerId: 1,
        pointerType: "touch",
        clientX: 120,
        clientY: 220,
      });
    if (cancel === "scroll")
      await page.locator(".chat-history").dispatchEvent("scroll");
    if (cancel === "cancel")
      await bubble.dispatchEvent("pointercancel", { pointerId: 1 });
    if (cancel === "up")
      await bubble.dispatchEvent("pointerup", { pointerId: 1 });
    expect(
      await bubble.evaluate(
        (el) =>
          !el.dispatchEvent(
            new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
          ),
      ),
    ).toBe(true);
    await page.waitForTimeout(550);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await bubble.dispatchEvent("pointerup", { pointerId: 1 });
  }
});

test("鼠标右键、键盘与辅助入口可用，小视口菜单及版本切换正常", async ({
  page,
}) => {
  await open(page);
  const ai = page.locator(".chat-assistant");
  await ai.locator(".chat-bubble-surface").nth(1).click({ button: "right" });
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const access = ai.getByRole("button", { name: "AI 消息操作" });
  await access.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(access).toBeFocused();
  expect(await access.evaluate((el) => getComputedStyle(el).clipPath)).toBe(
    "none",
  );
  await access.press("Shift+F10");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await access.press("Space");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await ai.getByRole("button", { name: "下一个回复版本" }).click();
  await expect(ai.locator(".chat-bubble-surface")).toHaveCount(2);
  await expect(ai.getByLabel("回复版本", { exact: true })).toContainText(
    "2 / 2",
  );
  await page.getByLabel("聊天消息").focus();
  await page.setViewportSize({ width: 390, height: 330 });
  await access.press("Enter");
  await expect(
    page.getByRole("button", { name: "复制", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "仅保存修改", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "取消", exact: true }),
  ).toBeInViewport();
});
