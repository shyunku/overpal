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
  /** base workers (only in /guild/{id}, not in /guilds) */
  pals?: Record<string, PdCampPal>;
}

export interface PdCampPal {
  nickname: string;
  pal_id: string;
  gender: string;
  level: string;
  /** "Healthful" etc. (PalDefender's spelling) */
  phisical_health: string;
  worker_sick: string;
  san: string;
}

/**
 * A pal of the player, /pals/{PlayerUID}. Numbers come as strings for the party and pal box
 * and as numbers for base workers.
 */
export interface PdPal {
  PalID: string;
  Nickname: string;
  Gender: string;
  Level: string | number;
  PhysicalHealth: string;
  WorkerSick: string;
  HP: string | number;
  Hunger: string | number;
  MaxHunger: string | number;
  SAN: string | number;
}

export interface PdPlayerPals {
  Meta: { PlayerUID: string; TeamCount: string; PalboxCount: string };
  Pals: {
    Team: Record<string, PdPal>;
    Palbox?: Record<string, PdPal>;
    /** the guild's bases with their workers */
    BaseCamps?: { id: string; world_pos: Vec3; map_pos: Vec3; pals: Record<string, PdPal> }[];
  };
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
