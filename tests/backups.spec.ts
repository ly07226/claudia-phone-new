import { readFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
async function seed(page: Page) {
  await page.goto("/");
  await expect(page.locator(".desktop")).toBeVisible();
  await page.evaluate(async (data) => {
    const { db, usePhone } = await import("/src/store.ts");
    const { getConversation } = await import("/src/chatService.ts");
    const { newBook, newEntry } = await import("/src/loreTypes.ts");
    await db.worlds.put({
      id: "backup-world",
      name: "用户世界",
      description: "背景",
      createdAt: 1,
    });
    await db.assets.bulkPut(
      ["asset-a", "asset-b", "orphan"].map((id) => ({
        id,
        type: "wallpaper" as const,
        data,
        createdAt: 1,
      })),
    );
    await db.characters.put({
      id: "backup-char",
      name: "角色",
      persona: "人格",
      avatar: "asset-a",
      worldId: "deleted-legacy-world",
      apiConfigId: "backup-api",
    });
    await db.worldProfiles.put({
      id: "backup-profile",
      worldId: "backup-world",
      characterId: "backup-char",
      setting: "世界资料",
    });
    await db.apiConfigs.put({
      id: "backup-api",
      name: "配置",
      provider: "openai-compatible",
      baseUrl: "https://backup.example.test/v1?token=synthetic-backup-key",
      apiKey: "synthetic-backup-key",
      model: "model",
      enabled: true,
      isDefault: true,
      temperature: 0.7,
      maxTokens: 100,
      createdAt: 1,
      updatedAt: 1,
    } as any);
    await db.apiCredentials.put({
      configId: "backup-api",
      apiKey: "synthetic-backup-key",
    });
    const c = await getConversation("backup-char");
    const world = await getConversation("backup-char", "backup-world");
    const user = {
      id: "backup-user",
      conversationId: c.id,
      role: "user" as const,
      content: "用户完整原文",
      createdAt: 1,
    };
    const ai = {
      id: "backup-ai",
      conversationId: c.id,
      role: "assistant" as const,
      content: "新回复",
      activeVariantId: "backup-v2",
      createdAt: 2,
    };
    const variants = [
      {
        id: "backup-v1",
        conversationId: c.id,
        messageId: ai.id,
        content: "旧回复",
        source: "legacy" as const,
        createdAt: 1,
      },
      {
        id: "backup-v2",
        conversationId: c.id,
        messageId: ai.id,
        content: "新回复",
        source: "generated" as const,
        createdAt: 2,
      },
    ];
    await db.messages.bulkPut([
      user,
      ai,
      {
        id: "backup-archived",
        conversationId: c.id,
        role: "user",
        content: "归档原文",
        archived: true,
        createdAt: 3,
      },
      {
        id: "backup-world-message",
        conversationId: world.id,
        role: "user",
        content: "世界原文",
        createdAt: 4,
      },
    ]);
    await db.messageVariants.bulkPut(variants);
    await db.messageRevisions.put({
      id: "backup-revision",
      conversationId: c.id,
      messageId: ai.id,
      variantId: "backup-v1",
      content: "修订前原文",
      createdAt: 3,
    });
    await db.conversationSnapshots.put({
      id: "backup-snapshot",
      conversationId: c.id,
      reason: "switch",
      createdAt: 4,
      messages: [
        user,
        { ...ai, activeVariantId: "backup-v1", content: "旧回复" },
      ],
      variants,
    });
    const book = {
      ...newBook(),
      id: "backup-book",
      name: "世界书",
      worldIds: ["backup-world", "deleted-world"],
      global: true,
    };
    const metadata = {
      date: new Date("2024-01-02T03:04:05Z"),
      missing: undefined,
      bytes: new Uint8Array([0, 1, 255]),
      file: new File([new Uint8Array([7, 8])], "original.bin", {
        type: "application/octet-stream",
        lastModified: 1234,
      }),
      largeInteger: 12345678901234567890n,
    };
    Object.defineProperty(metadata, "__proto__", {
      value: { safe: "kept" },
      enumerable: true,
    });
    await db.lorebooks.put(book);
    await db.loreEntries.put({
      ...newEntry(book.id),
      id: "backup-entry",
      content: "内容",
      constant: true,
      rawMetadata: metadata,
    });
    await db.themes.update("global", {
      wallpaper: "asset-a",
      worldId: "backup-world",
    });
    await db.items.update("app-0", { icon: "asset-b" });
    await usePhone.getState().reload();
    (window as any).__sourceBefore = Object.fromEntries(
      await Promise.all(
        db.tables.map(async (t) => [t.name, await t.toArray()]),
      ),
    );
  }, png);
}
async function exportFiles(page: Page, encrypted = false) {
  return page.evaluate(async (encrypted) => {
    const { createBackup } = await import("/src/backupService.ts");
    const result = await createBackup({
      closedOtherClients: true,
      includeCredentials: encrypted,
      credentialConsent: encrypted,
      password: encrypted ? "synthetic passphrase 123" : undefined,
    });
    (window as any).__export = result;
    const m = result.manifest;
    const files = [
      new File([JSON.stringify(m)], `${m.backupId}.manifest.json`, {
        type: "application/json",
      }),
    ];
    for (const p of m.parts)
      files.push(new File([await result.readPart(p.index)], p.name));
    (window as any).__files = files;
    let leaked = false;
    for (const f of files)
      if ((await f.text()).includes("synthetic-backup-key")) leaked = true;
    return { manifest: m, leaked };
  }, encrypted);
}
async function unchanged(page: Page) {
  expect(
    await page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      const now = Object.fromEntries(
        await Promise.all(
          db.tables.map(async (t) => [t.name, await t.toArray()]),
        ),
      );
      return (
        JSON.stringify(now, (_k, v) =>
          typeof v === "bigint" ? String(v) : v,
        ) ===
          JSON.stringify((window as any).__sourceBefore, (_k, v) =>
            typeof v === "bigint" ? String(v) : v,
          ) &&
        db.verno === 6 &&
        db.backendDB().version === 60
      );
    }),
  ).toBe(true);
}

test("18表完整分卷、默认无Key，版本/快照/图片及特殊元数据候选无损，主库不变", async ({
  page,
}) => {
  await seed(page);
  const { manifest, leaked } = await exportFiles(page);
  expect(Object.keys(manifest.tables)).toHaveLength(18);
  expect(manifest.tables.apiCredentials).toMatchObject({
    sourceCount: 1,
    count: 0,
  });
  expect(manifest.resources).toHaveLength(3);
  expect(manifest.redactions).toHaveLength(1);
  expect(leaked).toBe(false);
  const result = await page.evaluate(async () => {
    const { readBackup } = await import("/src/backupService.ts");
    const { db } = await import("/src/store.ts");
    const value = await readBackup((window as any).__files, {
      mode: "rehearse",
    });
    const D = Object.getPrototypeOf(db.constructor);
    const candidate = new D(value.report.candidateName!);
    candidate
      .version(6)
      .stores(
        Object.fromEntries(
          db.tables.map((t) => [
            t.name,
            [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(
              ",",
            ),
          ]),
        ),
      );
    await candidate.open();
    const meta = (await candidate.table("loreEntries").get("backup-entry"))
      .rawMetadata;
    const out = {
      report: value.report,
      variants: await candidate
        .table("messageVariants")
        .orderBy("id")
        .toArray(),
      snapshots: await candidate.table("conversationSnapshots").toArray(),
      revisions: await candidate.table("messageRevisions").toArray(),
      archived: await candidate.table("messages").get("backup-archived"),
      asset: await candidate.table("assets").get("orphan"),
      config: await candidate.table("apiConfigs").get("backup-api"),
      special:
        meta.date instanceof Date &&
        meta.date.toISOString() === "2024-01-02T03:04:05.000Z" &&
        Object.hasOwn(meta, "missing") &&
        meta.missing === undefined &&
        meta.bytes instanceof Uint8Array &&
        meta.bytes[2] === 255 &&
        meta.file instanceof File &&
        meta.file.name === "original.bin" &&
        meta.file.lastModified === 1234 &&
        new Uint8Array(await meta.file.arrayBuffer())[1] === 8 &&
        meta.largeInteger === 12345678901234567890n &&
        Object.hasOwn(meta, "__proto__") &&
        meta.__proto__.safe === "kept",
    };
    candidate.close();
    await value.dispose();
    await (window as any).__export.dispose();
    return out;
  });
  expect(result.report).toMatchObject({
    status: "rehearsed",
    resources: 3,
    recordDigestsMatch: true,
    referencesValid: true,
    sourceDatabaseWritten: false,
    schemaVersion: 6,
  });
  expect(result.report.candidateName).not.toBe("claudia-phone");
  expect(result.variants.map((v) => v.content)).toEqual(["旧回复", "新回复"]);
  expect(result.snapshots[0].messages[1].content).toBe("旧回复");
  expect(result.snapshots[0].variants).toHaveLength(2);
  expect(result.revisions[0].content).toBe("修订前原文");
  expect(result.archived.archived).toBe(true);
  expect(result.asset.data).toBe(png);
  expect(result.config.apiKey).toBeUndefined();
  expect(result.config.baseUrl).toBe("https://backup.example.test/v1");
  expect(result.special).toBe(true);
  await unchanged(page);
});

test("凭据必须主动同意且加密，错误密码失败，正确解密仅写候选", async ({
  page,
}) => {
  await seed(page);
  expect(
    await page.evaluate(async () => {
      try {
        await (
          await import("/src/backupService.ts")
        ).createBackup({
          closedOtherClients: true,
          includeCredentials: true,
          password: "synthetic passphrase 123",
        });
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  const { manifest, leaked } = await exportFiles(page, true);
  expect(manifest.credentials).toBe("encrypted");
  expect(manifest.tables.apiCredentials.count).toBe(1);
  expect(leaked).toBe(false);
  expect(
    await page.evaluate(async () => {
      try {
        await (
          await import("/src/backupService.ts")
        ).readBackup((window as any).__files, {
          mode: "rehearse",
          password: "wrong passphrase 123",
        });
        return false;
      } catch {
        return true;
      }
    }),
  ).toBe(true);
  const result = await page.evaluate(async () => {
    const { readBackup } = await import("/src/backupService.ts");
    const { db } = await import("/src/store.ts");
    const value = await readBackup((window as any).__files, {
      mode: "rehearse",
      password: "synthetic passphrase 123",
    });
    const D = Object.getPrototypeOf(db.constructor);
    const c = new D(value.report.candidateName!);
    await c.open();
    const record = await c.table("apiCredentials").get("backup-api");
    c.close();
    await value.dispose();
    await (window as any).__export.dispose();
    return {
      count: value.report.counts.apiCredentials,
      matches: record.apiKey === "synthetic-backup-key",
    };
  });
  expect(result).toEqual({ count: 1, matches: true });
  await unchanged(page);
});

test("跨分卷大记录完整，缺卷/损坏/重复/未知版本正确拒绝", async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const c = await db.conversations.toCollection().first();
    await db.messages.put({
      id: "large-backup-message",
      conversationId: c!.id,
      role: "user",
      content: "x".repeat(5 * 1024 * 1024),
      createdAt: 9,
    });
    (window as any).__sourceBefore = Object.fromEntries(
      await Promise.all(
        db.tables.map(async (t) => [t.name, await t.toArray()]),
      ),
    );
  });
  const { manifest } = await exportFiles(page);
  expect(manifest.parts.length).toBeGreaterThan(1);
  const checks = await page.evaluate(async () => {
    const { readBackup } = await import("/src/backupService.ts");
    const files: File[] = (window as any).__files;
    const expectFailure = async (input: File[]) => {
      try {
        const v = await readBackup(input, { mode: "verify" });
        await v.dispose();
        return false;
      } catch {
        return true;
      }
    };
    const damaged = new Uint8Array(await files[1].arrayBuffer());
    damaged[100] ^= 1;
    const badManifest = JSON.parse(await files[0].text());
    badManifest.schemaVersion = 7;
    const failures = await Promise.all([
      expectFailure(files.slice(0, -1)),
      expectFailure([
        files[0],
        new File([damaged], files[1].name),
        ...files.slice(2),
      ]),
      expectFailure([files[0], files[1], files[1]]),
      expectFailure([
        new File([JSON.stringify(badManifest)], files[0].name),
        ...files.slice(1),
      ]),
    ]);
    const good = await readBackup(files, { mode: "verify" });
    await good.dispose();
    await (window as any).__export.dispose();
    return { failures, count: good.report.counts.messages };
  });
  expect(checks.failures).toEqual([true, true, true, true]);
  expect(checks.count).toBe(5);
  await unchanged(page);
});

test("引用缺失与取消不会成功，原库和密钥保留；后台中断释放门禁", async ({
  page,
}) => {
  await seed(page);
  const cancel = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { createBackup } = await import("/src/backupService.ts");
    const { backupIsLocked } = await import("/src/backupGate.ts");
    const controller = new AbortController();
    let failed = false;
    try {
      await createBackup({
        closedOtherClients: true,
        signal: controller.signal,
        onProgress: () => controller.abort(),
      });
    } catch {
      failed = true;
    }
    const hidden = Object.getOwnPropertyDescriptor(document, "hidden");
    let background = false;
    try {
      await createBackup({
        closedOtherClients: true,
        onProgress: () => {
          Object.defineProperty(document, "hidden", {
            configurable: true,
            value: true,
          });
          document.dispatchEvent(new Event("visibilitychange"));
        },
      });
    } catch {
      background = true;
    }
    if (hidden) Object.defineProperty(document, "hidden", hidden);
    else delete (document as any).hidden;
    return {
      failed,
      background,
      unlocked: !backupIsLocked(),
      version: db.verno,
    };
  });
  expect(cancel).toEqual({
    failed: true,
    background: true,
    unlocked: true,
    version: 6,
  });
  await unchanged(page);
  await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    await db.items.update("app-0", { icon: "missing-image" });
    (window as any).__sourceBefore = Object.fromEntries(
      await Promise.all(
        db.tables.map(async (t) => [t.name, await t.toArray()]),
      ),
    );
  });
  await exportFiles(page);
  expect(
    await page.evaluate(async () => {
      try {
        await (
          await import("/src/backupService.ts")
        ).readBackup((window as any).__files, { mode: "rehearse" });
        return false;
      } catch (e) {
        await (window as any).__export.dispose();
        return (e as Error).message.includes("items.icon");
      }
    }),
  ).toBe(true);
  await unchanged(page);
});

test("跨标签拒绝与原生跨连接读锁：旧写入只能在快照结束后提交", async ({
  page,
  context,
}) => {
  await seed(page);
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator(".desktop")).toBeVisible();
  await page.bringToFront();
  expect(
    await page.evaluate(async () => {
      try {
        await (
          await import("/src/backupService.ts")
        ).createBackup({ closedOtherClients: true });
        return false;
      } catch (e) {
        return (e as Error).message.includes("其他");
      }
    }),
  ).toBe(true);
  await other.close();
  const result = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    const { createBackup, readBackup } = await import("/src/backupService.ts");
    const D = Object.getPrototypeOf(db.constructor);
    const native = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("claudia-phone");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    let writer: Promise<void> | undefined;
    let ownWrite: Promise<void> | undefined;
    let gateRejected = false;
    let queued = false;
    const exported = await createBackup({
      closedOtherClients: true,
      onProgress: () => {
        if (queued) return;
        queued = true;
        ownWrite = D.ignoreTransaction(() =>
          db.items.put({
            id: "guard-must-block",
            kind: "app",
            app: "聊天",
            pageId: "page-1",
            position: 99,
            size: 1,
          }),
        ).then(
          () => {},
          (e: Error) => {
            gateRejected = e.message.includes("写入已暂停");
          },
        );
        writer = new Promise<void>((resolve, reject) => {
          const tx = native.transaction("items", "readwrite");
          tx.objectStore("items").put({
            id: "old-client-after-cutoff",
            kind: "app",
            app: "聊天",
            pageId: "page-1",
            position: 99,
            size: 1,
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
    });
    await ownWrite;
    await writer;
    native.close();
    const m = exported.manifest;
    const files = [
      new File([JSON.stringify(m)], `${m.backupId}.manifest.json`),
    ];
    for (const p of m.parts)
      files.push(new File([await exported.readPart(p.index)], p.name));
    const read = await readBackup(files, { mode: "verify" });
    await read.dispose();
    await exported.dispose();
    return {
      gateRejected,
      sourceCount: await db.items.count(),
      snapshotCount: read.report.counts.items,
      blockedAbsent: !(await db.items.get("guard-must-block")),
      oldPresent: !!(await db.items.get("old-client-after-cutoff")),
    };
  });
  expect(result.gateRejected).toBe(true);
  expect(result.blockedAbsent).toBe(true);
  expect(result.oldPresent).toBe(true);
  expect(result.sourceCount).toBe(result.snapshotCount + 1);
});

test("手机设置入口、分卷下载、Files读回与候选报告；下载不标记已验证", async ({
  page,
}) => {
  await seed(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "数据备份与恢复", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "数据备份与恢复", exact: true }),
  ).toBeVisible();
  await page.getByLabel("我已关闭其他 Claudia Phone 标签页和独立 PWA").check();
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "保存全部文件", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "校验报告" })).toHaveCount(0);
  await page.getByRole("button", { name: "准备清单文件", exact: true }).click();
  const manifestDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "点击保存：清单", exact: true }).click();
  const mFile = await manifestDownload;
  const collected: { name: string; path: string }[] = [
    { name: mFile.suggestedFilename(), path: (await mFile.path())! },
  ];
  const parts = page.getByRole("button", { name: /^准备分卷/ });
  for (let i = 0; i < (await parts.count()); i++) {
    await parts.nth(i).click();
    await expect(
      page.getByRole("link", { name: "点击保存：当前分卷", exact: true }),
    ).toBeVisible();
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("link", { name: "点击保存：当前分卷", exact: true })
      .click();
    const f = await downloaded;
    collected.push({ name: f.suggestedFilename(), path: (await f.path())! });
  }
  await page.getByLabel("选择备份文件").setInputFiles(
    await Promise.all(
      collected.map(async (f) => ({
        name: f.name,
        mimeType: f.name.endsWith(".json")
          ? "application/json"
          : "application/octet-stream",
        buffer: await readFile(f.path),
      })),
    ),
  );
  await page.getByRole("button", { name: "验证备份", exact: true }).click();
  await expect(page.getByRole("region", { name: "校验报告" })).toContainText(
    "备份已验证",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "恢复演练", exact: true }).click();
  await expect(page.getByRole("region", { name: "校验报告" })).toContainText(
    "候选恢复演练通过",
  );
  await expect(page.getByRole("button", { name: /覆盖正式/ })).toHaveCount(0);
  for (const width of [320, 390, 844]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page
        .locator(".backup-page")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "返回设置", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "设置", exact: true }),
  ).toBeVisible();
  await unchanged(page);
});
