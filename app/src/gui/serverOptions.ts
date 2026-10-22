// What the game server's settings mean, for the server settings screen (ServerSettings.tsx): the
// common ones grouped with Korean names, and a description for the rest.
// Mock: docs/designs/server-settings-mock.html.

export type OptKind = "text" | "pw" | "num" | "sel" | "tog";

export interface CommonOpt {
  key: string;
  name: string;
  /** shown under the name (short) */
  note?: string;
  /** shown in the tooltip */
  desc: string;
  kind: OptKind;
  unit?: string;
  choices?: [string, string][];
  /** takes a whole row */
  wide?: boolean;
}

export const GROUPS: [string, CommonOpt[]][] = [
  [
    "서버",
    [
      {
        key: "ServerName",
        name: "서버 이름",
        note: "서버 목록과 접속 화면에 보입니다.",
        desc: "서버 목록과 접속 화면에 보이는 이름입니다.",
        kind: "text",
        wide: true,
      },
      {
        key: "ServerDescription",
        name: "서버 설명",
        desc: "서버 목록에 보이는 설명입니다.",
        kind: "text",
        wide: true,
      },
      {
        key: "ServerPassword",
        name: "접속 비밀번호",
        note: "비워 두면 누구나 접속합니다.",
        desc: "친구들이 서버에 들어올 때 입력하는 비밀번호입니다. 비워 두면 누구나 접속합니다.",
        kind: "text",
        wide: true,
      },
      {
        key: "AdminPassword",
        name: "관리자 비밀번호",
        note: "서버 관리에 쓰입니다.",
        desc: "서버 관리와 관리 API(REST)에 쓰는 비밀번호입니다. Overpal도 이 값으로 서버에 접속합니다.",
        kind: "pw",
        wide: true,
      },
      {
        key: "ServerPlayerMaxNum",
        name: "최대 인원",
        note: "1~32",
        desc: "동시에 접속할 수 있는 플레이어 수입니다.",
        kind: "num",
        unit: "명",
      },
      {
        key: "AutoSaveSpan",
        name: "자동 저장 간격",
        desc: "월드를 자동으로 저장하는 간격(초)입니다.",
        kind: "num",
        unit: "초",
      },
    ],
  ],
  [
    "게임 배율",
    [
      {
        key: "ExpRate",
        name: "경험치",
        desc: "얻는 경험치 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PalCaptureRate",
        name: "포획 확률",
        desc: "팰을 잡을 확률 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "WorkSpeedRate",
        name: "팰 작업 속도",
        desc: "거점 팰이 작업하는 속도 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PalSpawnNumRate",
        name: "팰 출현 수",
        note: "높을수록 서버가 무거워집니다.",
        desc: "월드에 나오는 팰 수 배율입니다. 높을수록 서버가 무거워집니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "DayTimeSpeedRate",
        name: "낮 시간 속도",
        desc: "낮이 흐르는 속도입니다. 높을수록 낮이 짧아집니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "NightTimeSpeedRate",
        name: "밤 시간 속도",
        desc: "밤이 흐르는 속도입니다. 높을수록 밤이 짧아집니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "CollectionDropRate",
        name: "채집 획득량",
        desc: "나무·광석 등을 채집할 때 얻는 양의 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "EnemyDropItemRate",
        name: "적 드롭량",
        desc: "쓰러뜨린 적이 떨어뜨리는 아이템 양의 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PalEggDefaultHatchingTime",
        name: "알 부화 시간",
        note: "거대한 알 기준",
        desc: "알이 부화하는 데 걸리는 시간(시간)입니다. 거대한 알 기준이며 작은 알은 더 빨리 부화합니다.",
        kind: "num",
        unit: "시간",
      },
      {
        key: "ItemWeightRate",
        name: "아이템 무게",
        desc: "아이템 무게 배율입니다. 낮을수록 많이 들고 다닐 수 있습니다.",
        kind: "num",
        unit: "배",
      },
    ],
  ],
  [
    "전투·생존",
    [
      {
        key: "PalDamageRateAttack",
        name: "팰이 주는 피해",
        desc: "팰이 주는 피해 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PalDamageRateDefense",
        name: "팰이 받는 피해",
        desc: "팰이 받는 피해 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PlayerDamageRateAttack",
        name: "플레이어가 주는 피해",
        desc: "플레이어가 주는 피해 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PlayerDamageRateDefense",
        name: "플레이어가 받는 피해",
        desc: "플레이어가 받는 피해 배율입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PlayerStomachDecreaceRate",
        name: "배고픔 속도",
        desc: "플레이어가 배고파지는 속도입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "PlayerStaminaDecreaceRate",
        name: "스태미나 소모",
        desc: "플레이어 스태미나가 줄어드는 속도입니다.",
        kind: "num",
        unit: "배",
      },
      {
        key: "DeathPenalty",
        name: "죽으면 떨어뜨리는 것",
        desc: "플레이어가 죽었을 때 그 자리에 떨어뜨리는 것입니다.",
        kind: "sel",
        choices: [
          ["None", "없음"],
          ["Item", "아이템"],
          ["ItemAndEquipment", "아이템·장비"],
          ["All", "아이템·장비·팰"],
        ],
      },
    ],
  ],
  [
    "규칙",
    [
      {
        key: "bEnableInvaderEnemy",
        name: "거점 습격",
        note: "적이 거점을 습격합니다.",
        desc: "적 무리가 거점을 습격하는 이벤트를 켭니다.",
        kind: "tog",
      },
      {
        key: "bEnableFastTravel",
        name: "빠른 이동",
        desc: "빠른 이동을 쓸 수 있습니다.",
        kind: "tog",
      },
      {
        key: "bEnableFriendlyFire",
        name: "같은 편 공격",
        desc: "같은 길드끼리도 피해를 줍니다.",
        kind: "tog",
      },
      { key: "bIsPvP", name: "PvP", desc: "PvP 서버로 엽니다.", kind: "tog" },
      {
        key: "bEnablePlayerToPlayerDamage",
        name: "플레이어끼리 피해",
        desc: "플레이어가 다른 플레이어에게 피해를 줄 수 있습니다.",
        kind: "tog",
      },
      {
        key: "bShowPlayerList",
        name: "접속자 목록 보이기",
        note: "ESC 메뉴에 접속자 목록",
        desc: "ESC 메뉴에 접속자 목록을 보여 줍니다.",
        kind: "tog",
      },
    ],
  ],
  [
    "길드·거점",
    [
      {
        key: "GuildPlayerMaxNum",
        name: "길드 최대 인원",
        desc: "길드 하나에 들어갈 수 있는 플레이어 수입니다.",
        kind: "num",
        unit: "명",
      },
      {
        key: "BaseCampMaxNumInGuild",
        name: "길드당 거점 수",
        note: "최대 10",
        desc: "길드 하나가 가질 수 있는 거점 수입니다(최대 10).",
        kind: "num",
        unit: "개",
      },
      {
        key: "BaseCampWorkerMaxNum",
        name: "거점 작업 팰 수",
        note: "최대 50",
        desc: "거점 하나에서 일하는 팰 최대 수입니다(최대 50).",
        kind: "num",
        unit: "마리",
      },
      {
        key: "DropItemAliveMaxHours",
        name: "떨어진 아이템 유지",
        desc: "바닥에 떨어진 아이템이 사라지기까지의 시간(시간)입니다.",
        kind: "num",
        unit: "시간",
      },
    ],
  ],
];

/** what the rest mean (the server's own names are shown for these) */
export const ADV_DESC: Record<string, string> = {
  Difficulty: "난이도 묶음입니다. 전용 서버에서는 보통 None으로 두고 배율을 직접 정합니다.",
  RandomizerType: "팰 출현을 무작위로 섞습니다. None 섞지 않음, Region 지역 안에서, All 전체.",
  RandomizerSeed: "무작위 섞기에 쓰는 시드 값입니다.",
  bIsRandomizerPalLevelRandom: "무작위 섞기 때 팰 레벨도 무작위로 합니다.",
  PlayerAutoHPRegeneRate: "플레이어 체력이 저절로 차는 속도입니다.",
  PlayerAutoHpRegeneRateInSleep: "잘 때 플레이어 체력이 차는 속도입니다.",
  PalStomachDecreaceRate: "팰이 배고파지는 속도입니다.",
  PalStaminaDecreaceRate: "팰 스태미나가 줄어드는 속도입니다.",
  PalAutoHPRegeneRate: "팰 체력이 저절로 차는 속도입니다.",
  PalAutoHpRegeneRateInSleep: "팰이 쉴 때(팰 상자 안) 체력이 차는 속도입니다.",
  BuildObjectHpRate: "건축물 체력 배율입니다.",
  BuildObjectDamageRate: "건축물이 받는 피해 배율입니다.",
  BuildObjectDeteriorationDamageRate: "거점 밖 건축물이 낡아 부서지는 속도입니다. 0이면 낡지 않습니다.",
  CollectionObjectHpRate: "나무·광석 같은 채집물의 체력입니다.",
  CollectionObjectRespawnSpeedRate: "채집물이 다시 생기는 간격 배율입니다. 작을수록 빨리 생깁니다.",
  bActiveUNKO: "팰이 똥을 쌉니다.",
  bEnableAimAssistPad: "게임패드 조준 보조를 켭니다.",
  bEnableAimAssistKeyboard: "키보드·마우스 조준 보조를 켭니다.",
  DropItemMaxNum: "월드에 떨어져 있을 수 있는 아이템 최대 수입니다.",
  PhysicsActiveDropItemMaxNum: "물리 계산을 하는 떨어진 아이템 최대 수입니다. -1이면 제한 없음.",
  DropItemMaxNum_UNKO: "월드에 남는 똥 최대 수입니다.",
  BaseCampMaxNum: "서버 전체 거점 최대 수입니다.",
  bAutoResetGuildNoOnlinePlayers: "오래 아무도 접속하지 않은 길드를 자동으로 해산합니다.",
  AutoResetGuildTimeNoOnlinePlayers: "자동 해산까지 아무도 접속하지 않은 시간(시간)입니다.",
  bIsMultiplay: "협동(멀티) 월드 여부입니다. 전용 서버에서는 바꿀 일이 없습니다.",
  bHardcore: "하드코어: 죽으면 캐릭터를 잃습니다.",
  bPalLost: "죽으면 데리고 있던 팰을 잃습니다.",
  bCharacterRecreateInHardcore: "하드코어에서 죽은 뒤 캐릭터를 다시 만들 수 있게 합니다.",
  bCanPickupOtherGuildDeathPenaltyDrop: "다른 길드 플레이어가 죽으며 떨어뜨린 것을 주울 수 있습니다.",
  bEnableNonLoginPenalty: "오래 접속하지 않으면 거점 팰이 굶는 등 불이익이 생깁니다.",
  bEnableFastTravelOnlyBaseCamp: "빠른 이동 도착지를 거점으로만 제한합니다.",
  bIsStartLocationSelectByMap: "처음 시작할 위치를 지도에서 고릅니다.",
  bExistPlayerAfterLogout: "나간 뒤에도 캐릭터가 월드에 남습니다.",
  bEnableDefenseOtherGuildPlayer: "다른 길드 플레이어가 오면 거점 팰이 막아 싸웁니다.",
  bInvisibleOtherGuildBaseCampAreaFX: "다른 길드 거점의 범위 표시를 숨깁니다.",
  bBuildAreaLimit: "던전 입구·보스 근처 등 일부 장소에 건축을 막습니다.",
  CoopPlayerMaxNum: "협동 월드 최대 인원입니다. 전용 서버는 '최대 인원'을 씁니다.",
  bAllowClientMod: "모드를 쓰는 클라이언트의 접속을 허용합니다.",
  PublicIP: "커뮤니티 서버 목록에 알릴 공인 IP입니다.",
  RCONEnabled: "RCON(원격 명령)을 켭니다.",
  RCONPort: "RCON이 쓰는 포트입니다.",
  Region: "커뮤니티 서버 목록에 보일 지역입니다.",
  bUseAuth: "Steam 등 계정 인증을 사용합니다. 끄지 않는 게 좋습니다.",
  BanListURL: "공식 차단 목록 주소입니다.",
  ChatPostLimitPerMinute: "한 사람이 1분에 보낼 수 있는 채팅 수입니다.",
  CrossplayPlatforms: "접속을 허용할 플랫폼입니다.",
  bIsUseBackupSaveData: "월드 백업을 따로 저장합니다.",
  LogFormatType: "서버 로그 형식입니다(Text 또는 Json).",
  bIsShowJoinLeftMessage: "접속·퇴장 메시지를 보여 줍니다.",
  SupplyDropSpan: "보급품이 떨어지는 간격(분)입니다.",
  EnablePredatorBossPal: "포식자(프레데터) 보스 팰이 나옵니다.",
  MaxBuildingLimitNum: "거점 하나에 지을 수 있는 건축물 수입니다. 0이면 제한 없음.",
  MaxBuildingLimitNumPerPlayer: "플레이어 한 명이 지을 수 있는 건축물 수입니다. 0이면 제한 없음.",
  ServerReplicatePawnCullDistance: "다른 캐릭터·팰을 보여 주는 거리입니다. 작을수록 서버가 가벼워집니다.",
  bAllowGlobalPalboxExport: "글로벌 팰 상자로 팰을 내보낼 수 있습니다.",
  bAllowGlobalPalboxImport: "글로벌 팰 상자에서 팰을 가져올 수 있습니다.",
  EquipmentDurabilityDamageRate: "장비 내구도가 닳는 속도입니다.",
  ItemContainerForceMarkDirtyInterval: "상자 내용을 강제로 동기화하는 간격(초)입니다. 바꿀 일이 거의 없습니다.",
  PlayerDataPalStorageUpdateCheckTickInterval: "팰 보관함 변경을 확인하는 간격(초)입니다. 바꿀 일이 거의 없습니다.",
  ItemCorruptionMultiplier: "음식 등이 상하는 속도입니다.",
  MonsterFarmActionSpeedRate: "목장 팰이 아이템을 만드는 속도입니다.",
  FishingDifficultyRate: "낚시 난이도입니다.",
  DenyTechnologyList: "배울 수 없게 막을 기술 목록입니다.",
  GuildRejoinCooldownMinutes: "길드를 나간 뒤 다시 들어가기까지 기다리는 시간(분)입니다.",
  AutoTransferMasterCheckIntervalSeconds: "길드장 자동 위임을 확인하는 간격(초)입니다.",
  AutoTransferMasterThresholdDays: "길드장이 이 일수만큼 접속하지 않으면 다른 길드원에게 넘깁니다.",
  MaxGuildsPerFrame: "한 번에 처리하는 길드 수입니다. 바꿀 일이 거의 없습니다.",
  BlockRespawnTime: "죽은 뒤 다시 살아나기까지 기다리는 시간(초)입니다.",
  RespawnPenaltyDurationThreshold: "이 시간 안에 다시 죽으면 연달아 죽은 것으로 봅니다.",
  RespawnPenaltyTimeScale: "연달아 죽을 때 부활 대기 시간이 늘어나는 배율입니다.",
  bDisplayPvPItemNumOnWorldMap_BaseCamp: "PvP: 지도에 거점이 가진 아이템 수를 보여 줍니다.",
  bDisplayPvPItemNumOnWorldMap_Player: "PvP: 지도에 플레이어가 가진 아이템 수를 보여 줍니다.",
  AdditionalDropItemWhenPlayerKillingInPvPMode: "PvP에서 플레이어를 쓰러뜨리면 추가로 떨어지는 아이템입니다.",
  AdditionalDropItemNumWhenPlayerKillingInPvPMode: "PvP에서 추가로 떨어지는 아이템 개수입니다.",
  bAdditionalDropItemWhenPlayerKillingInPvPMode: "PvP에서 플레이어를 쓰러뜨리면 아이템을 추가로 떨어뜨립니다.",
  bEnableVoiceChat: "게임 안 보이스 채팅을 켭니다.",
  VoiceChatMaxVolumeDistance: "보이스가 가장 크게 들리는 거리입니다.",
  VoiceChatZeroVolumeDistance: "보이스가 들리지 않게 되는 거리입니다.",
  bAllowEnhanceStat_Health: "체력 스탯 강화를 허용합니다.",
  bAllowEnhanceStat_Attack: "공격 스탯 강화를 허용합니다.",
  bAllowEnhanceStat_Stamina: "스태미나 스탯 강화를 허용합니다.",
  bAllowEnhanceStat_Weight: "무게 스탯 강화를 허용합니다.",
  bAllowEnhanceStat_WorkSpeed: "작업 속도 스탯 강화를 허용합니다.",
  bEnableBuildingPlayerUIdDisplay: "건축물에 지은 사람을 보여 줍니다.",
  BuildingNameDisplayCacheTTLSeconds: "지은 사람 이름을 기억해 두는 시간(초)입니다.",
  bAllowEnemyCampSpawnNearBaseCamp: "거점 근처에 적 캠프가 생길 수 있습니다.",
};

const NUMBER = /^-?\d+(\.\d+)?$/;

/** a value as the screen shows it: no quotes, 1.000000 as 1 */
export function shown(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  if (NUMBER.test(v)) return String(Number(v));
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return v.slice(1, -1);
  return v;
}

export const isBool = (raw: string | null | undefined) => /^(true|false)$/i.test((raw ?? "").trim());
export const isNumber = (raw: string | null | undefined) => NUMBER.test((raw ?? "").trim());

/** text, lists and the like take a whole row; numbers and on/off stay narrow */
export function isLong(raw: string | null | undefined): boolean {
  const v = (raw ?? "").trim();
  if (isBool(v) || isNumber(v)) return false;
  return v === "" || v.startsWith('"') || v.startsWith("(") || v.length > 10;
}
