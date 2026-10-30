import { test, expect, type Page } from "@playwright/test";
const chinese = "中文长消息不能进入头像区域".repeat(60) + "。";
const multi =
  "第一句。\n" +
  "LongUnbrokenEnglishCharacters".repeat(30) +
  ".\nhttps://example.test/" +
  "very-long-path-segment".repeat(35) +
  "\n嗯。";
async function open(page: Page, world = false) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  await page.evaluate(
    async ({ chinese, multi }) => {
      const { db } = await import("/src/store.ts");
      const { getConversation } = await import("/src/chatService.ts");
      await db.characters.put({
        id: "bounds-character",
        name: "边界角色",
        persona: "",
      });
      await db.worlds.put({
        id: "bounds-world",
        name: "用户自定义背景",
        description: "",
        createdAt: 1,
      });
      await db.worldProfiles.put({
        id: "bounds-profile",
        characterId: "bounds-character",
        worldId: "bounds-world",
        setting: "",
      });
      for (const c of [
        await getConversation("bounds-character"),
        await getConversation("bounds-character", "bounds-world"),
      ]) {
        const rows = [
          { key: "user-long", role: "user", content: chinese + "\n" + multi },
          { key: "ai-long", role: "assistant", content: chinese },
          { key: "user-short", role: "user", content: "嗯" },
          { key: "ai-short", role: "assistant", content: "嗯" },
          { key: "multi", role: "assistant", content: multi },
        ] as const;
        for (const [index, row] of rows.entries()) {
          const id = `${c.id}-${row.key}`;
          await db.messages.put({
            id,
            conversationId: c.id,
            role: row.role,
            content: row.content,
            createdAt: index,
            ...(row.role === "assistant"
              ? { activeVariantId: `${id}-v1` }
              : {}),
          });
          if (row.role === "assistant")
            await db.messageVariants.put({
              id: `${id}-v1`,
              conversationId: c.id,
              messageId: id,
              content: row.content,
              source: "legacy",
              createdAt: 1,
            });
          if (row.key === "multi")
            await db.messageVariants.put({
              id: `${id}-v2`,
              conversationId: c.id,
              messageId: id,
              content: "新版本的第一句。\n新版本的第二句。",
              source: "generated",
              createdAt: 2,
            });
        }
      }
    },
    { chinese, multi },
  );
  await page.reload();
  if (world)
    await page.evaluate(async () => {
      const { usePhone } = await import("/src/store.ts");
      const { useSpaces } = await import("/src/spaces.ts");
      await useSpaces.getState().enterSpace("world:bounds-world");
      usePhone
        .getState()
        .set({ activeApp: "世界聊天", worldId: "bounds-world" });
    });
  else await page.getByRole("button", { name: "聊天", exact: true }).click();
  await page.getByRole("button", { name: /边界角色.*开始/ }).click();
  await expect(page.locator(".chat-message-row")).toHaveCount(5);
}

async function assertBounds(page: Page) {
  const rows = await page.locator(".chat-message-row").evaluateAll((nodes) =>
    nodes.map((el) => {
      const box = el.getBoundingClientRect();
      const avatar = el.querySelector(".chat-avatar")!.getBoundingClientRect();
      const style = getComputedStyle(el);
      const gap = parseFloat(style.columnGap);
      const middle = {
        left: box.left + avatar.width + gap,
        right: box.right - avatar.width - gap,
      };
      const surfaces = [
        ...el.querySelectorAll<HTMLElement>(".chat-bubble-surface"),
      ].map((s) => {
        const b = s.getBoundingClientRect();
        return {
          left: b.left,
          right: b.right,
          width: b.width,
          overflow:
            s.scrollWidth > s.clientWidth + 1 ||
            s.querySelector("p")!.scrollWidth >
              s.querySelector("p")!.clientWidth + 1,
        };
      });
      const version = el
        .querySelector(".message-versions")
        ?.getBoundingClientRect();
      return {
        display: style.display,
        user: el.classList.contains("chat-message-row-user"),
        middle,
        box: { left: box.left, right: box.right },
        avatar: { left: avatar.left, right: avatar.right },
        surfaces,
        version: version ? { left: version.left, right: version.right } : null,
      };
    }),
  );
  for (const row of rows) {
    expect(row.display).toBe("grid");
    expect(
      Math.abs(
        (row.user ? row.avatar.right : row.avatar.left) -
          (row.user ? row.box.right : row.box.left),
      ),
    ).toBeLessThan(1);
    for (const bubble of row.surfaces) {
      expect(bubble.left).toBeGreaterThanOrEqual(row.middle.left - 1);
      expect(bubble.right).toBeLessThanOrEqual(row.middle.right + 1);
      expect(
        Math.abs(
          (row.user ? bubble.right : bubble.left) -
            (row.user ? row.middle.right : row.middle.left),
        ),
      ).toBeLessThan(1);
      expect(bubble.overflow).toBe(false);
    }
    if (row.version) {
      expect(Math.abs(row.version.left - row.middle.left)).toBeLessThan(1);
      expect(row.version.right).toBeLessThanOrEqual(row.middle.right + 1);
    }
  }
  for (const index of [0, 1])
    expect(
      Math.abs(
        rows[index].surfaces[0].width -
          (rows[index].middle.right - rows[index].middle.left),
      ),
    ).toBeLessThan(1);
  for (const index of [2, 3])
    expect(rows[index].surfaces[0].width).toBeLessThan(
      (rows[index].middle.right - rows[index].middle.left) * 0.6,
    );
  expect(
    await page
      .locator(".chat-history")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
}

for (const world of [false, true])
  test(`${world ? "World" : "Daily"} 三列边界：中文/英文/URL/连续字符与短泡，多屏宽不侵入头像`, async ({
    page,
  }) => {
    await open(page, world);
    for (const width of [280, 320, 360, 375, 390, 414, 430, 844]) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i++)
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
      });
      await assertBounds(page);
    }
    const original = page.locator('[data-message-id$="-multi"]');
    expect((await original.locator("p").allTextContents()).join("")).toBe(
      multi,
    );
    expect(
      await original.locator(".chat-bubble-surface").count(),
    ).toBeGreaterThan(1);
  });

test("三列中长按完整消息与版本切换仍正常，末条不被输入框遮挡", async ({
  page,
}) => {
  await open(page);
  await page.setViewportSize({ width: 320, height: 568 });
  const group = page.locator('[data-message-id$="-multi"]');
  const last = group.locator(".chat-bubble-surface").last();
  await last.scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  });
  await last.dispatchEvent("pointerdown", {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    clientX: 90,
    clientY: 200,
  });
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await last.dispatchEvent("pointerup", { pointerId: 1 });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByLabel("编辑消息内容")).toHaveValue(multi);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await group.getByRole("button", { name: "下一个回复版本" }).click();
  await expect(group.locator(".chat-bubble-surface")).toHaveCount(2);
  await expect(group.getByLabel("回复版本", { exact: true })).toContainText(
    "2 / 2",
  );
  await assertBounds(page);
  const userAccess = page
    .locator('[data-message-id$="-user-short"]')
    .getByRole("button", { name: "用户消息操作" });
  await userAccess.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "消息操作", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(
    await userAccess.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const content = el
        .closest(".chat-message-stack")!
        .getBoundingClientRect();
      return b.left >= content.left && b.right <= content.right;
    }),
  ).toBe(true);
  await page.getByLabel("当前会话消息").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(
    await group
      .locator(".message-versions")
      .evaluate(
        (el) =>
          el.getBoundingClientRect().bottom <=
          document.querySelector(".chat-compose")!.getBoundingClientRect().top,
      ),
  ).toBe(true);
});
