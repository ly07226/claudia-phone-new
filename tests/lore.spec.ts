import { test, expect } from "@playwright/test";
async function open(page: any) {
  await page.goto("/");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "世界书 / Lorebook", exact: true })
    .click();
}
test("手机原生世界书与条目 CRUD、启停、关键词编辑、导出", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "新建世界书", exact: true }).click();
  await page.getByLabel("世界书名称", { exact: true }).fill("我的规则");
  await page.getByLabel("全局世界书").check();
  await page.getByRole("button", { name: "保存世界书", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的规则", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "展开世界书 我的规则", exact: true })
    .click();
  await page.getByRole("button", { name: "新增条目", exact: true }).click();
  await page.getByLabel("条目名称", { exact: true }).fill("基础约束");
  await page
    .getByLabel("条目关键词", { exact: true })
    .pressSequentially("alpha,beta");
  await expect(page.getByLabel("条目关键词", { exact: true })).toHaveValue(
    "alpha,beta",
  );
  await page
    .getByLabel("条目内容", { exact: true })
    .fill("ONLY_CONTENT_NOT_TITLE");
  await page.getByLabel("条目激活方式").selectOption("constant");
  await page.getByRole("button", { name: "保存条目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "基础约束", exact: true }),
  ).toBeVisible();
  const entrySwitch = page.getByRole("switch", {
    name: "条目「基础约束」启用",
    exact: true,
  });
  await entrySwitch.click();
  await expect(entrySwitch).toHaveAttribute("aria-checked", "false");
  await entrySwitch.click();
  await expect(entrySwitch).toHaveAttribute("aria-checked", "true");
  await page
    .getByRole("button", { name: "展开条目 基础约束", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑条目", exact: true }).click();
  await page.getByLabel("条目内容", { exact: true }).fill("edited-content");
  await page.getByRole("button", { name: "保存条目", exact: true }).click();
  const bookSwitch = page.getByRole("switch", {
    name: "世界书「我的规则」启用",
    exact: true,
  });
  await bookSwitch.click();
  await expect(bookSwitch).toHaveAttribute("aria-checked", "false");
  await bookSwitch.click();
  await expect(bookSwitch).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "导出为 Claudia Phone JSON" }).click();
  await expect(
    page.getByRole("link", { name: "下载 JSON 文件" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "世界书 / Lorebook", exact: true })
    .click();
  await page
    .getByRole("button", { name: "展开世界书 我的规则", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "基础约束", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "展开条目 基础约束", exact: true })
    .click();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "删除条目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "基础约束", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "删除世界书", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "我的规则", exact: true }),
  ).toHaveCount(0);
});
test("常驻、命中、未命中、辅助逻辑、禁用、预算和世界隔离", async ({ page }) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { newBook, newEntry } = await import("/src/loreTypes.ts");
    const { getConversation } = await import("/src/chatService.ts");
    const { buildContext } = await import("/src/chatContext.ts");
    await db.characters.put({ id: "lore-c", name: "test", persona: "persona" });
    await db.worlds.bulkPut([
      { id: "lore-a", name: "测试甲", description: "", createdAt: 1 },
      { id: "lore-b", name: "测试乙", description: "", createdAt: 1 },
    ]);
    await db.worldProfiles.bulkPut([
      { id: "pa", worldId: "lore-a", characterId: "lore-c", setting: "" },
      { id: "pb", worldId: "lore-b", characterId: "lore-c", setting: "" },
    ]);
    const global = { ...newBook(), name: "TITLE_NEVER_PROMPT", global: true };
    const a = { ...newBook(), name: "A", worldIds: ["lore-a"] };
    const b = { ...newBook(), name: "B", worldIds: ["lore-b"] };
    await db.lorebooks.bulkPut([global, a, b]);
    const constant = {
      ...newEntry(global.id),
      title: "COMMENT_NEVER_PROMPT",
      constant: true,
      content: "GLOBAL_CONSTANT",
    };
    const keyed = {
      ...newEntry(global.id),
      primaryKeys: ["trigger"],
      content: "KEYWORD_HIT",
    };
    const nohit = {
      ...newEntry(global.id),
      primaryKeys: ["absent"],
      content: "NEVER_ABSENT",
    };
    const disabled = {
      ...newEntry(global.id),
      constant: true,
      enabled: false,
      content: "NEVER_DISABLED",
    };
    const selective = {
      ...newEntry(global.id),
      primaryKeys: ["trigger"],
      secondaryKeys: ["extra"],
      selective: true,
      content: "SELECTIVE_HIT",
    };
    const ae = { ...newEntry(a.id), constant: true, content: "A_ONLY" };
    const be = { ...newEntry(b.id), constant: true, content: "B_ONLY" };
    await db.loreEntries.bulkPut([
      constant,
      keyed,
      nohit,
      disabled,
      selective,
      ae,
      be,
    ]);
    const daily = await getConversation("lore-c");
    const ca = await getConversation("lore-c", "lore-a");
    const cb = await getConversation("lore-c", "lore-b");
    for (const c of [daily, ca, cb])
      await db.messages.add({
        id: crypto.randomUUID(),
        conversationId: c.id,
        role: "user",
        content: "TRIGGER extra",
        createdAt: 1,
      });
    const contexts = [];
    for (const c of [daily, ca, cb])
      contexts.push((await buildContext(c))[0].content);
    await db.lorebooks.update(global.id, { enabled: false });
    const off = (await buildContext(daily))[0].content;
    await db.lorebooks.update(global.id, { enabled: true, charBudget: 100 });
    await db.loreEntries.add({
      ...newEntry(global.id),
      constant: true,
      priority: 999,
      content: "x".repeat(120),
    });
    const limited = (await buildContext(daily))[0].content;
    const { entryActive } = await import("/src/loreEngine.ts");
    const logic = [0, 1, 2, 3].map((n) =>
      entryActive(
        {
          ...selective,
          secondaryKeys: ["extra", "missing"],
          selectiveLogic: n as 0 | 1 | 2 | 3,
        },
        global,
        [
          {
            id: "m",
            conversationId: daily.id,
            role: "user",
            content: "trigger extra",
            createdAt: 1,
          },
        ],
      ),
    );
    return { contexts, off, limited, logic };
  });
  for (const c of result.contexts) {
    expect(c).toContain("GLOBAL_CONSTANT");
    expect(c).toContain("KEYWORD_HIT");
    expect(c).toContain("SELECTIVE_HIT");
    expect(c).not.toMatch(
      /TITLE_NEVER_PROMPT|COMMENT_NEVER_PROMPT|NEVER_ABSENT|NEVER_DISABLED/,
    );
  }
  expect(result.contexts[0]).not.toMatch(/A_ONLY|B_ONLY/);
  expect(result.contexts[1]).toContain("A_ONLY");
  expect(result.contexts[1]).not.toContain("B_ONLY");
  expect(result.contexts[2]).toContain("B_ONLY");
  expect(result.contexts[2]).not.toContain("A_ONLY");
  expect(result.off).not.toContain("GLOBAL_CONSTANT");
  expect(result.limited).not.toContain("x".repeat(120));
  expect(result.logic).toEqual([true, true, false, false]);
});
test("ST 适配、未知字段、预览确认、失败保护与 Native 往返", async ({
  page,
}) => {
  await open(page);
  const fixture = {
    name: "外部资料",
    entries: {
      0: {
        uid: 0,
        key: ["forest"],
        keysecondary: ["night"],
        comment: "Entry",
        content: "FOREIGN_CONTENT",
        constant: false,
        selective: true,
        selectiveLogic: 3,
        order: 500,
        position: 0,
        disable: false,
      },
      1: {
        uid: 1,
        key: [],
        content: "ADVANCED",
        constant: true,
        position: 4,
        depth: 2,
        probability: 50,
        useProbability: true,
        futureUnknown: { value: 1 },
      },
    },
  };
  await page.getByLabel("导入世界书", { exact: true }).setInputFiles({
    name: "world.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole("heading", { name: "导入预览" })).toBeVisible();
  await expect(page.locator(".lore-preview")).toContainText(
    "SillyTavern / Tavern",
  );
  await expect(page.locator(".lore-preview")).toContainText("当前未完全支持");
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return db.lorebooks.count();
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "确认导入" }).click();
  await page
    .getByRole("button", { name: "展开世界书 外部资料", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "外部资料", exact: true }),
  ).toBeVisible();
  const roundtrip = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { exportLorebook, parseLorebook, importLorebook } =
      await import("/src/loreImport.ts");
    const book = (await db.lorebooks.toArray())[0];
    const entries = await db.loreEntries
      .where("lorebookId")
      .equals(book.id)
      .toArray();
    const doc = exportLorebook(book, entries);
    const p = parseLorebook(doc);
    const imported = await importLorebook(p);
    const rows = await db.loreEntries
      .where("lorebookId")
      .equals(imported.id)
      .toArray();
    return {
      doc,
      original: entries
        .sort((a, b) => a.content.localeCompare(b.content))
        .map(({ id, lorebookId, createdAt, updatedAt, ...e }) => e),
      restored: rows
        .sort((a, b) => a.content.localeCompare(b.content))
        .map(({ id, lorebookId, createdAt, updatedAt, ...e }) => e),
      book: imported,
    };
  });
  expect(roundtrip.restored).toEqual(roundtrip.original);
  expect(
    roundtrip.original.find((e) => e.content === "FOREIGN_CONTENT"),
  ).toMatchObject({
    primaryKeys: ["forest"],
    secondaryKeys: ["night"],
    priority: 500,
    insertionPosition: "before-profile",
    selectiveLogic: 3,
    enabled: true,
  });
  expect(
    roundtrip.original.find((e) => e.content === "ADVANCED")!
      .compatibilityIssues.length,
  ).toBeGreaterThan(0);
  expect(roundtrip.book.global).toBe(false);
  expect(roundtrip.book.worldIds).toEqual([]);
  expect(roundtrip.doc).not.toMatch(/apiKey|messages|conversations/);
  await page.getByLabel("导入世界书", { exact: true }).setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await expect(page.getByRole("alert")).toContainText("无法解析");
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return {
        books: await db.lorebooks.count(),
        entries: await db.loreEntries.count(),
      };
    }),
  ).toEqual({ books: 2, entries: 4 });
});
test("v3 到 v4 增量迁移保留每张旧表，事务失败不留下半本世界书", async ({
  page,
}) => {
  await open(page);
  const result = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { newBook, newEntry } = await import("/src/loreTypes.ts");
    const { importLorebook } = await import("/src/loreImport.ts");
    const DexieBase = Object.getPrototypeOf(db.constructor);
    db.close();
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.deleteDatabase("claudia-phone");
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    const old = new DexieBase("claudia-phone");
    old.version(1).stores({
      worlds: "id,createdAt",
      characters: "id,worldId",
      pages: "id,order",
      items: "id,pageId,position",
      themes: "id,worldId",
      assets: "id,type",
    });
    old
      .version(2)
      .stores({ apiConfigs: "id,provider", apiCredentials: "configId" });
    old.version(3).stores({
      conversations: "id,&scopeKey,characterId,worldId,updatedAt",
      messages: "id,conversationId,[conversationId+createdAt]",
      worldProfiles: "id,&[worldId+characterId],worldId,characterId",
    });
    await old.open();
    const before: any = {};
    for (const t of old.tables) {
      const row =
        t.name === "apiCredentials"
          ? { configId: "preserve", apiKey: "synthetic-only" }
          : { id: "preserve", value: "unchanged" };
      await t.put(row);
      before[t.name] = await t.toArray();
    }
    old.close();
    await db.open();
    const after: any = {};
    for (const name of Object.keys(before))
      after[name] = await db.table(name).toArray();
    const b = { ...newBook(), name: "transaction" };
    const e = { ...newEntry(b.id), content: "valid" };
    const original = db.loreEntries.bulkAdd.bind(db.loreEntries);
    db.loreEntries.bulkAdd = (async () => {
      throw Error("simulated storage failure");
    }) as typeof db.loreEntries.bulkAdd;
    let failed = false;
    try {
      await importLorebook({
        format: "Claudia Phone",
        book: b,
        entries: [e],
        total: 1,
        valid: 1,
        issues: 0,
        warnings: [],
      });
    } catch {
      failed = true;
    } finally {
      db.loreEntries.bulkAdd = original;
    }
    return {
      before,
      after,
      failed,
      books: await db.lorebooks.count(),
      entries: await db.loreEntries.count(),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.failed).toBe(true);
  expect(result.books).toBe(0);
  expect(result.entries).toBe(0);
});


test("常驻规则不可被截断为误导性片段，预算不足时明确诊断", async ({page}) => {
  await page.goto("/");
  const result=await page.evaluate(async()=>{
    const {newBook,newEntry}=await import("/src/loreTypes.ts");
    const {planLore}=await import("/src/loreEngine.ts");
    const book=newBook();
    const constant={...newEntry(book.id),constant:true,priority:100,content:"允许合理推进剧情，但绝对不能替用户决定行动。"};
    const optional={...newEntry(book.id),constant:false,primaryKeys:["测试"],content:"辅助资料"};
    const history=[{id:"lore-budget-user",conversationId:"test",role:"user" as const,content:"测试",createdAt:1}];
    const insufficient=planLore([{book,entry:constant}],history,constant.content.length-1);
    const enough=planLore([{book,entry:constant},{book,entry:optional}],history,200);
    return {insufficient:insufficient.entries.map(e=>e.content),diagnostic:insufficient.diagnostics[0],enough:enough.entries.map(e=>e.content)};
  });
  expect(result.insufficient).toEqual([]);
  expect(result.diagnostic.reason).toBe("context-budget");
  expect(result.diagnostic.outcome).toBe("skipped");
  expect(result.enough[0]).toBe("允许合理推进剧情，但绝对不能替用户决定行动。");
  expect(result.enough).toContain("辅助资料");
});
