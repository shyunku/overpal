// PalDefender REST responses as passed through by the app server.
// Only the fields this app uses are typed.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface PdPlayer {
  Name: string;
  PlayerUID: string;
  UserId: string;
  GuildName: string;
  GuildUUID: string;
  /** "Online" | "Offline" */
  Status: string;
  WorldLocation: Vec3;
  MapLocation: Vec3;
}

export interface PdPlayers {
  Meta: { PlayerCount: number; OnlineCount: number };
  Players: PdPlayer[];
}

export interface PdCamp {
  id: string;
  world_pos: Vec3;
  map_pos: Vec3;
}

export interface PdGuild {
  name: string;
  Level: number;
  admin: { id: string; name: string };
  camp_count: number;
  camps: PdCamp[];
  member_count: number;
  members: string[];
}

export interface PdGuilds {
  Meta: { GuildCount: number };
  Guilds: Record<string, PdGuild>;
}

export interface PdContainer {
  Available: boolean;
  ContainerID: string;
  UsedSlots: number;
  MaxSlots: number;
  /** occupied slots keyed by slot index */
  Slots: Record<string, { ItemID: string; Count: number }>;
}

export interface PdInventory {
  Meta: { PlayerUID: string; Player: string };
  Inventory: {
    Items: PdContainer;
    KeyItems: PdContainer;
    Weapons: PdContainer;
    Armor: PdContainer;
    Food: PdContainer;
    DropSlot: PdContainer;
  };
}
