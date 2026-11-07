import { test, expect } from "@playwright/test";

// Audit-only contracts. A fresh Playwright context uses the normal application
// startup; these tests issue no table writes, schema changes or migrations.
test("3.0.2-A 只读核对现有v7全部20表及主键索引", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".desktop")).toBeVisible();
  const inventory = await page.evaluate(async () => {
    const { db } = await import("/src/store.ts");
    return {
      logicalVersion: db.verno,
      nativeVersion: db.backendDB().version,
      tables: Object.fromEntries(
        db.tables.map((t) => [
          t.name,
          {
            primary: t.schema.primKey.src,
            indexes: t.schema.indexes.map((i) => i.src).sort(),
          },
        ]),
      ),
    };
  });
  expect(inventory.logicalVersion).toBe(7);
  expect(inventory.nativeVersion).toBe(70);
  const schemas: Record<string, string> = {
    storySessions:'id,&worldId',
    storyNodes:'id,worldId,sessionId,parentNodeId,&requestId',
    timelines:"id,conversationId,parentTimelineId",
    pathNodes:"id,conversationId,[conversationId+parentNodeId+fingerprint]",
    worlds: "id,createdAt",
    characters: "id,worldId",
    pages: "id,order",
    items: "id,pageId,position",
    themes: "id,worldId",
    assets: "id,type",
    apiConfigs: "id,provider",
    apiCredentials: "configId",
    conversations: "id,&scopeKey,characterId,worldId,updatedAt",
    messages: "id,conversationId,[conversationId+createdAt]",
    worldProfiles: "id,&[worldId+characterId],worldId,characterId",
    lorebooks: "id,updatedAt",
    loreEntries: "id,lorebookId",
    messageVariants: "id,messageId,conversationId",
    messageRevisions: "id,messageId,conversationId,variantId",
    conversationSnapshots: "id,conversationId,createdAt",
  };
  expect(inventory.tables).toEqual(
    Object.fromEntries(
      Object.entries(schemas).map(([name, source]) => {
        const [primary, ...indexes] = source.split(",");
        return [name, { primary, indexes: indexes.sort() }];
      }),
    ),
  );
});

test("3.0.2-A 只读快照确认导航及刷新不迁移或改写任何现有表", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".desktop")).toBeVisible();
  const capture = () =>
    page.evaluate(async () => {
      const { db } = await import("/src/store.ts");
      return db.transaction("r", db.tables, async () =>
        Object.fromEntries(
          await Promise.all(
            db.tables.map(async (t) => [t.name, await t.toArray()]),
          ),
        ),
      );
    });
  const before = await capture();
  await page.getByRole("button", { name: "返回空间列表", exact: true }).click();
  await expect(page.getByTestId("daily-space")).toBeVisible();
  await page.getByRole("button", { name: "进入日常手机", exact: true }).click();
  await expect(page.locator(".desktop")).toBeVisible();
  await page.reload();
  await expect(page.locator(".desktop")).toBeVisible();
  expect(await capture()).toEqual(before);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("claudia.navigation.v1")!),
    ),
  ).toEqual({ version: 1, route: { screen: "phone", spaceId: "daily" } });
});
