import { test, expect } from "@playwright/test";
async function open(page: any) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "世界书 / Lorebook", exact: true })
    .click();
}
async function seed(page: any, count = 2) {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "聊天", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (count) => {
    const { db } = await import("/src/store.ts");
    const { newBook, newEntry } = await import("/src/loreTypes.ts");
    for (let n = 0; n < count; n++) {
      const book = {
        ...newBook(),
        id: `fold-${n}`,
        name: `世界书 ${n}`,
        description: `简介 ${n} ` + "长文本".repeat(80),
        createdAt: count - n,
        enabled: n % 2 === 0,
        global: true,
        worldIds: ["preserved-world"],
      };
      await db.lorebooks.put(book);
      await db.loreEntries.put({
        ...newEntry(book.id),
        id: `entry-${n}`,
        title: `条目 ${n}`,
        primaryKeys: ["关键词"],
        content: `隐藏长内容 ${n}`,
        constant: true,
        regex: true,
        useProbability: true,
        probability: 75,
        insertionPosition: "at-depth",
        insertionDepth: 2,
        role: "assistant",
      });
    }
  }, count);
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "世界书 / Lorebook", exact: true })
    .click();
}
test("默认折叠、开关独立、展开状态不因持久化丢失，刷新仍保留启停", async ({
  page,
}) => {
  await seed(page);
  const headerBox = await page
    .getByRole("button", { name: "返回桌面", exact: true })
    .boundingBox();
  expect(headerBox!.y).toBeGreaterThanOrEqual(0);
  expect(headerBox!.x).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: "artifacts/lorebook-collapsed-mobile.png" });
  expect(
    await page
      .locator(".lore-app")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  const book = page.locator('[data-book-id="fold-0"]');
  const toggle = book.getByRole("button", {
    name: "展开世界书 世界书 0",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(book).toContainText("1 条目");
  await expect(
    page.getByRole("button", { name: "新增条目", exact: true }),
  ).toHaveCount(0);
  const sw = book.getByRole("switch", {
    name: "世界书「世界书 0」启用",
    exact: true,
  });
  await sw.tap();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(
    book.getByRole("button", { name: "收起世界书 世界书 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(
    book.getByRole("button", { name: "新增条目", exact: true }),
  ).toBeVisible();
  const entry = book.locator('[data-entry-id="entry-0"]');
  await expect(
    entry.getByRole("button", { name: "展开条目 条目 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(entry.getByText("隐藏长内容 0", { exact: true })).toHaveCount(0);
  const entrySwitch = entry.getByRole("switch");
  await entrySwitch.click();
  await expect(entrySwitch).toHaveAttribute("aria-checked", "false");
  await expect(
    entry.getByRole("button", { name: "展开条目 条目 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await entry
    .getByRole("button", { name: "展开条目 条目 0", exact: true })
    .click();
  await expect(entry.getByText("隐藏长内容 0", { exact: true })).toBeVisible();
  await entrySwitch.click();
  await expect(entrySwitch).toHaveAttribute("aria-checked", "true");
  await expect(
    entry.getByRole("button", { name: "收起条目 条目 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await entrySwitch.click();
  await expect(entrySwitch).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  const state = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return {
      book: await db.lorebooks.get("fold-0"),
      entry: await db.loreEntries.get("entry-0"),
    };
  });
  expect(state.book).toMatchObject({
    enabled: false,
    global: true,
    worldIds: ["preserved-world"],
  });
  expect(state.entry).toMatchObject({
    enabled: false,
    regex: true,
    useProbability: true,
    probability: 75,
    role: "assistant",
    insertionDepth: 2,
  });
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "世界书 / Lorebook", exact: true })
    .click();
  await expect(
    book.getByRole("switch", { name: "世界书「世界书 0」启用", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(
    book.getByRole("button", { name: "展开世界书 世界书 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await book
    .getByRole("button", { name: "展开世界书 世界书 0", exact: true })
    .click();
  await expect(entry.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
test("搜索筛选、分页、书复制与二次确认删除，筛选不清除展开状态", async ({
  page,
}) => {
  await seed(page, 25);
  await expect(page.locator(".lore-book-card")).toHaveCount(20);
  await page.getByRole("button", { name: "下一组世界书" }).click();
  await expect(page.locator(".lore-book-card")).toHaveCount(5);
  await page.getByLabel("搜索世界书", { exact: true }).fill("世界书 0");
  await expect(page.locator(".lore-book-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "展开世界书 世界书 0", exact: true })
    .click();
  await page.getByRole("button", { name: "已启用", exact: true }).click();
  await page
    .locator('[data-book-id="fold-0"]')
    .getByRole("switch", { name: "世界书「世界书 0」启用", exact: true })
    .click();
  await expect(page.locator(".lore-book-card")).toHaveCount(0);
  await page.getByRole("button", { name: "未启用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "收起世界书 世界书 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "复制世界书", exact: true }).click();
  await page.getByRole("button", { name: "全部", exact: true }).click();
  await expect(page.locator(".lore-book-card")).toHaveCount(2);
  await expect(
    page.getByRole("button", {
      name: "展开世界书 世界书 0（副本）",
      exact: true,
    }),
  ).toHaveAttribute("aria-expanded", "false");
  const copied = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const b = await db.lorebooks
      .filter((b) => b.name === "世界书 0（副本）")
      .first();
    return {
      b,
      entries: await db.loreEntries.where("lorebookId").equals(b!.id).count(),
    };
  });
  expect(copied.b).toMatchObject({
    enabled: false,
    global: true,
    worldIds: ["preserved-world"],
  });
  expect(copied.entries).toBe(1);
  await page.getByRole("button", { name: "编辑世界书", exact: true }).click();
  await expect(page.getByLabel("世界书名称", { exact: true })).toBeInViewport();
  await page.getByLabel("世界书描述", { exact: true }).fill("已编辑简介");
  await page.getByRole("button", { name: "保存世界书", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "收起世界书 世界书 0", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  let dialogs = 0;
  page.on("dialog", (d) => {
    dialogs++;
    void (dialogs % 2 === 0 ? d.dismiss() : d.accept());
  });
  await page.getByRole("button", { name: "删除世界书", exact: true }).click();
  await expect(page.locator('[data-book-id="fold-0"]')).toBeVisible();
  expect(dialogs).toBe(2);
  await page.screenshot({ path: "artifacts/lorebook-library-mobile.png" });
});
test("导入后仍折叠，禁用后 Prompt 立即不注入且绑定和条目不变", async ({
  page,
}) => {
  await open(page);
  await page.getByLabel("导入世界书", { exact: true }).setInputFiles({
    name: "fold-import.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        name: "导入折叠",
        entries: {
          0: { uid: 0, constant: true, content: "CONSTANT_TO_TEST", key: [] },
        },
      }),
    ),
  });
  await page.getByRole("button", { name: "确认导入" }).click();
  await expect(
    page.getByRole("button", { name: "展开世界书 导入折叠", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "新增条目" })).toHaveCount(0);
  await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const b = (await db.lorebooks.toArray())[0];
    await db.lorebooks.update(b.id, { global: true });
  });
  const sw = page.getByRole("switch", {
    name: "世界书「导入折叠」启用",
    exact: true,
  });
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "false");
  const off = await page.evaluate(async () => {
    const { loreForConversation } = await import("/src/loreEngine.ts");
    return (
      await loreForConversation(
        {
          id: "test",
          scopeKey: "test",
          characterId: "test",
          mode: "daily",
          createdAt: 1,
          updatedAt: 1,
        },
        [],
      )
    ).activated;
  });
  expect(off).toHaveLength(0);
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  const on = await page.evaluate(async () => {
    const { loreForConversation } = await import("/src/loreEngine.ts");
    return (
      await loreForConversation(
        {
          id: "test",
          scopeKey: "test",
          characterId: "test",
          mode: "daily",
          createdAt: 1,
          updatedAt: 1,
        },
        [],
      )
    ).activated;
  });
  expect(on).toHaveLength(1);
});
