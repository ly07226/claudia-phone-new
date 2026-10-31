import { test, expect, type Page } from "@playwright/test";

const text =
  "这是一句较长的聊天回复，保持自然换行，不占满不必要的空间。\n\n第二句。\n\n" +
  "很长的内容正常换行。".repeat(12) +
  "\n\n最后一句。";
async function open(page: Page, content = text) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (content) => {
    const { db } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    await db.characters.put({
      id: "layout-char",
      name: "布局角色",
      persona: "",
    });
    const c = await getConversation("layout-char");
    for (let i = 0; i < 3; i++) {
      await db.messages.put({
        id: `layout-${i}`,
        conversationId: c.id,
        role: i === 0 ? "user" : "assistant",
        content: i === 1 ? "前一条回复。" : content,
        activeVariantId: i ? `layout-v${i}` : undefined,
        createdAt: i,
      });
      if (i)
        await db.messageVariants.put({
          id: `layout-v${i}`,
          conversationId: c.id,
          messageId: `layout-${i}`,
          content: i === 1 ? "前一条回复。" : content,
          source: "legacy",
          createdAt: 1,
        });
    }
    await db.messageVariants.put({
      id: "layout-extra",
      conversationId: c.id,
      messageId: "layout-2",
      content: "另一版本。\n\n第二段。",
      source: "generated",
      createdAt: 2,
    });
  }, content);
  await page.reload();
  await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /布局角色.*开始/ }).click();
}

test("气泡组间20px、组内12px、自适应宽度和边界换行不产生留白", async ({
  page,
}) => {
  await open(page);
  const group = page.locator('[data-message-id="layout-2"]');
  await expect(group.locator(".chat-bubble-surface")).toHaveCount(15);
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    await expect
      .poll(() =>
        page.locator(".chat-history").evaluate((el) => el.clientWidth),
      )
      .toBeGreaterThan(250);
    const metrics = await group.evaluate((el) => {
      const surfaces = [
        ...el.querySelectorAll<HTMLElement>(".chat-bubble-surface"),
      ];
      const boxes = surfaces.map((s) => s.getBoundingClientRect());
      const row = el.closest(".chat-message-row")!;
      const previous = row.previousElementSibling!.getBoundingClientRect();
      const avatar = row.querySelector(".chat-avatar")!.getBoundingClientRect();
      const versions = el
        .querySelector(".message-versions")!
        .getBoundingClientRect();
      const p = surfaces[1].querySelector("p")!;
      return {
        gaps: boxes.slice(1).map((b, i) => b.top - boxes[i].bottom),
        lefts: boxes.map((b) => b.left),
        widths: boxes.map((b) => b.width),
        groupGap: row.getBoundingClientRect().top - previous.bottom,
        avatarTop: avatar.top - boxes[0].top,
        avatarRight: avatar.right,
        versionGap: versions.top - boxes.at(-1)!.bottom,
        shortHeight: p.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(p).lineHeight),
        overflow: surfaces.some((s) => s.scrollWidth > s.clientWidth + 1),
        historyOverflow:
          document.querySelector(".chat-history")!.scrollWidth >
          document.querySelector(".chat-history")!.clientWidth,
      };
    });
    expect(metrics.gaps.every((gap) => Math.abs(gap - 12) < 1)).toBe(true);
    expect(Math.abs(metrics.groupGap - 20)).toBeLessThan(1);
    expect(
      Math.max(...metrics.lefts) - Math.min(...metrics.lefts),
    ).toBeLessThan(1);
    expect(Math.abs(metrics.avatarTop)).toBeLessThan(1);
    expect(metrics.avatarRight).toBeLessThan(metrics.lefts[0]);
    expect(metrics.widths[1]).toBeLessThan(metrics.widths[0] - 20);
    expect(metrics.versionGap).toBeGreaterThanOrEqual(6);
    expect(metrics.versionGap).toBeLessThanOrEqual(8);
    expect(Math.abs(metrics.shortHeight - metrics.lineHeight)).toBeLessThan(1);
    expect(metrics.overflow).toBe(false);
    expect(metrics.historyOverflow).toBe(false);
  }
  expect((await group.locator("p").allTextContents()).join("")).toBe(text);
  await expect(group.getByRole("button", { name: "AI 消息操作" })).toHaveCount(
    1,
  );
  await expect(
    page.locator('[data-message-id="layout-1"] .message-versions'),
  ).toHaveCount(0);
  await expect(group.locator(".message-versions")).toHaveCount(1);
  await expect(
    group.locator("xpath=../..").locator(".chat-avatar"),
  ).toHaveCount(1);
});

test("消息组末条与版本不被输入框遮挡，任意气泡仍打开整组菜单", async ({
  page,
}) => {
  await open(page);
  const group = page.locator('[data-message-id="layout-2"]');
  for (const height of [844, 350]) {
    await page.setViewportSize({ width: 390, height });
    await page.getByLabel("当前会话消息").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const layout = await group.evaluate((el) => {
      const history = document
        .querySelector(".chat-history")!
        .getBoundingClientRect();
      const compose = document
        .querySelector(".chat-compose")!
        .getBoundingClientRect();
      const last = [...el.querySelectorAll(".chat-bubble-surface")]
        .at(-1)!
        .getBoundingClientRect();
      const version = el
        .querySelector(".message-versions")!
        .getBoundingClientRect();
      return {
        last: last.bottom,
        version: version.bottom,
        top: version.top,
        history: history.bottom,
        compose: compose.top,
      };
    });
    expect(layout.version).toBeLessThanOrEqual(layout.history + 1);
    expect(layout.version).toBeLessThanOrEqual(layout.compose + 1);
    expect(layout.last).toBeLessThan(layout.top);
  }
  const bubble = group.locator(".chat-bubble-surface").last();
  await bubble.scrollIntoViewIfNeeded();
  // Resizing and scrolling intentionally cancel long presses. Start after the
  // visualViewport RAF updates and queued scroll events have settled.
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  });
  await bubble.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX: 80,
    clientY: 180,
  });
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await bubble.dispatchEvent("pointerup", { pointerId: 1 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("编辑消息内容")).toHaveValue(text);
  await page.getByRole("button", { name: "取消", exact: true }).click();
});

test("只收起边界空行，正文内部换行、用户文本和存储原文不变", async ({
  page,
}) => {
  const original = "\n\n“这一行保持原样。\n下一行也保持原样。”\n\n";
  await open(page, original);
  const group = page.locator('[data-message-id="layout-2"]');
  await expect(group.locator(".chat-bubble-surface")).toHaveCount(1);
  const layout = await group.locator("p").evaluate((el) => ({
    text: el.textContent,
    visible: el.innerText,
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    spaces: [...el.querySelectorAll(".chat-bubble-boundary-space")].map(
      (s) => getComputedStyle(s).display,
    ),
  }));
  expect(layout.text).toBe(original);
  expect(layout.visible).toBe("“这一行保持原样。\n下一行也保持原样。”");
  expect(Math.abs(layout.height - 2 * layout.lineHeight)).toBeLessThan(1);
  expect(layout.spaces).toEqual(["none", "none"]);
  await expect(
    page.locator(".chat-user .chat-bubble-boundary-space"),
  ).toHaveCount(0);
  const stored = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return {
      content: (await db.messages.get("layout-2"))!.content,
      version: db.verno,
    };
  });
  expect(stored).toEqual({ content: original, version: 5 });
  await page.screenshot({ path: "artifacts/chat-bubbles-2.3.4.4.png" });
});
