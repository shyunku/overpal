import { describe, expect, it } from "vitest";
import type { BaseStorage, Storage } from "../types";
import type { PdGuilds, PdInventory, PdPlayers } from "./paldefender";
import { BASE_RADIUS, aggregate, baseAt, buildSnapshot, inventoryOnly, inventoryStorage, withInventory, type BaseView } from "./snapshot";
import baseStorageFixture from "./__fixtures__/base_storage.json";
import guildsFixture from "./__fixtures__/guilds.json";
import playersFixture from "./__fixtures__/players.json";

// captured from the test server on 2026-10-12 (see docs/game-internals.md)
const storage = baseStorageFixture as BaseStorage;
const guilds = guildsFixture as PdGuilds;
const players = playersFixture as PdPlayers;
const GUILD = "550A88ED-45A08C78-E5FA84BC-74F75B00";
const CAMP = "4912370B-4ED23C7B-D19C32BC-DE202CDE";

const totalsOf = (t: { item: string; count: number }[]) => Object.fromEntries(t.map((x) => [x.item, x.count]));

function storageAt(id: string, group: string, x: number, items: [string, number][]): Storage {
  return {
    containerId: id,
    group,
    kind: "chest",
    location: { x, y: 0, z: 0 },
    slotCount: 10,
    items: items.map(([item, count], index) => ({ index, item, count })),
  };
}

describe("buildSnapshot with captured server data", () => {
  const snap = buildSnapshot(storage, guilds, players);
  const guild = snap.guilds.find((g) => g.guildId === GUILD)!;

  it("finds the guild and its one base", () => {
    expect(snap.guilds).toHaveLength(1);
    expect(guild.name).toBe("무명 길드");
    expect(guild.bases.map((b) => b.campId)).toEqual([CAMP]);
  });

  it("puts the 4 chests and the workbench into the base", () => {
    const base = guild.bases[0];
    expect(base.storages.filter((s) => s.kind === "chest")).toHaveLength(4);
    expect(base.storages.filter((s) => s.kind === "production")).toHaveLength(1);
    expect(totalsOf(base.totals)).toEqual({ Stone: 80, PalSphere: 28, Wood: 24, Berries: 13, BerrySeeds: 10, Wool: 5 });
  });

  it("keeps storages without a location outside the base", () => {
    expect(guild.elsewhere.filter((s) => s.kind === "pickup")).toHaveLength(29);
    expect(guild.elsewhere.filter((s) => s.kind === "guildStorage")).toHaveLength(1);
  });

  it("totals every storage of the guild except map pickups", () => {
    // the 29 pickups (stones, branches, berry bushes) are left out; the guild storage is empty
    expect(totalsOf(guild.totals)).toEqual({ Stone: 80, PalSphere: 28, Wood: 24, Berries: 13, BerrySeeds: 10, Wool: 5 });
  });

  it("lists where an item is stored", () => {
    const wood = guild.bases[0].totals.find((t) => t.item === "Wood")!;
    expect(wood.sources.map((s) => s.count).sort()).toEqual([12, 12]);
  });

  it("maps players", () => {
    expect(snap.players).toEqual([
      expect.objectContaining({ name: "shyunku-test", guildId: GUILD, online: false }),
    ]);
  });
});

describe("aggregate", () => {
  it("merges the same item from several slots of one container into one source", () => {
    const t = aggregate([storageAt("A", "G", 0, [["Stone", 999], ["Stone", 1]])]);
    expect(t).toEqual([{ item: "Stone", count: 1000, sources: [{ containerId: "A", kind: "chest", count: 1000 }] }]);
  });

  it("ignores map pickups", () => {
    const pickup: Storage = { ...storageAt("P", "G", 0, [["Berries", 2]]), kind: "pickup" };
    expect(aggregate([pickup, storageAt("A", "G", 0, [["Berries", 1]])])).toEqual([
      { item: "Berries", count: 1, sources: [{ containerId: "A", kind: "chest", count: 1 }] },
    ]);
  });

  it("counts items players dropped on the ground", () => {
    const dropped: Storage = { ...storageAt("D", "G", 0, [["Wood", 1]]), kind: "dropped" };
    expect(aggregate([dropped]).map((t) => [t.item, t.count])).toEqual([["Wood", 1]]);
  });

  it("sorts by count, then by item id", () => {
    const t = aggregate([storageAt("A", "G", 0, [["Wood", 5], ["Stone", 5], ["Wool", 9]])]);
    expect(t.map((x) => x.item)).toEqual(["Wool", "Stone", "Wood"]);
  });
});

describe("inventory", () => {
  const container = (slots: Record<string, [string, number]>) => ({
    Available: true,
    ContainerID: "c",
    UsedSlots: Object.keys(slots).length,
    MaxSlots: 42,
    Slots: Object.fromEntries(Object.entries(slots).map(([k, [ItemID, Count]]) => [k, { ItemID, Count }])),
  });
  const inv: PdInventory = {
    Meta: { PlayerUID: "P", Player: "P" },
    Inventory: {
      Items: container({ "0": ["Wood", 30], "3": ["Stone", 5] }),
      KeyItems: container({ "0": ["Relic", 1] }),
      Weapons: container({ "0": ["Bow", 1] }),
      Armor: container({}),
      Food: container({ "1": ["Berries", 10] }),
      DropSlot: container({}),
    },
  };

  it("takes carried items and food, not equipment or key items", () => {
    const s = inventoryStorage(inv, "G");
    expect(s.kind).toBe("inventory");
    expect(s.items.map((i) => [i.item, i.count])).toEqual([["Wood", 30], ["Stone", 5], ["Berries", 10]]);
  });

  it("adds the inventory to the base totals", () => {
    const base = buildSnapshot(storage, guilds, players).guilds[0].bases[0];
    const merged = withInventory(base, inventoryStorage(inv, GUILD));
    expect(totalsOf(merged.totals).Wood).toBe(24 + 30);
    expect(merged.totals.find((t) => t.item === "Wood")!.sources.map((s) => s.containerId)).toContain("inventory");
    // the original base is left as it was
    expect(totalsOf(base.totals).Wood).toBe(24);
  });
});

describe("buildSnapshot edge cases", () => {
  const camp = { id: "C", world_pos: { x: 0, y: 0, z: 0 }, map_pos: { x: 0, y: 0, z: 0 } };
  const pdGuilds: PdGuilds = {
    Meta: { GuildCount: 1 },
    Guilds: {
      G: { name: "g", Level: 1, admin: { id: "", name: "" }, camp_count: 1, camps: [camp], member_count: 0, members: [] },
    },
  };

  it("leaves storages beyond the base radius outside the base", () => {
    const s: BaseStorage = {
      version: 1,
      updatedAt: 0,
      storages: [storageAt("near", "G", BASE_RADIUS, [["Stone", 1]]), storageAt("far", "G", BASE_RADIUS + 1, [["Wood", 1]])],
    };
    const g = buildSnapshot(s, pdGuilds, null).guilds[0];
    expect(g.bases[0].storages.map((x) => x.containerId)).toEqual(["near"]);
    expect(g.elsewhere.map((x) => x.containerId)).toEqual(["far"]);
  });

  it("puts the guild's buildings into the nearest base", () => {
    const s: BaseStorage = {
      version: 1,
      updatedAt: 0,
      storages: [],
      buildings: [
        { buildObjectId: "Workbench", group: "G", location: { x: 100, y: 0, z: 0 } },
        { buildObjectId: "ItemChest", group: "G", location: { x: BASE_RADIUS + 1, y: 0, z: 0 } },
        { buildObjectId: "CampFire", group: "OTHER", location: { x: 0, y: 0, z: 0 } },
      ],
    };
    const base = buildSnapshot(s, pdGuilds, null).guilds.find((g) => g.guildId === "G")!.bases[0];
    expect(base.buildings.map((b) => b.buildObjectId)).toEqual(["Workbench"]);
  });

  it("still shows guilds when PalDefender is unavailable", () => {
    const s: BaseStorage = { version: 1, updatedAt: 0, storages: [storageAt("a", "G", 0, [["Stone", 3]])] };
    const snap = buildSnapshot(s, null, null);
    expect(snap.guilds).toHaveLength(1);
    expect(snap.guilds[0].bases).toEqual([]);
    expect(snap.guilds[0].elsewhere).toHaveLength(1);
    expect(snap.players).toEqual([]);
  });
});

describe("baseAt", () => {
  const camp = (id: string, x: number): BaseView => ({ campId: id, worldPos: { x, y: 0, z: 0 }, mapPos: { x: 0, y: 0, z: 0 }, storages: [], totals: [], buildings: [] });
  const bases = [camp("A", 0), camp("B", 100000)];

  it("picks the base the player stands in", () => {
    expect(baseAt(bases, { x: 99000, y: 500, z: 0 })?.campId).toBe("B");
  });

  it("is null outside every base or without a position", () => {
    expect(baseAt(bases, { x: 50000, y: 0, z: 0 })).toBeNull();
    expect(baseAt(bases, undefined)).toBeNull();
  });

  it("counts only the inventory outside bases", () => {
    const v = inventoryOnly(storageAt("inventory", "G", 0, [["Wood", 3]]));
    expect(v.campId).toBe("");
    expect(totalsOf(v.totals)).toEqual({ Wood: 3 });
  });
});
