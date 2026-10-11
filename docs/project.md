# palworld-helper-mod

팰월드 전용 서버에서 게임 데이터를 실시간으로 꺼내 게임 화면 위 오버레이로 보여주는 프로젝트.

## 목적

- 거점에 저장된 모든 아이템(상자 속 포함)을 실시간으로 조회한다.
- 플레이어 위치, 팰, 길드 같은 정보와 합쳐 게임 위 오버레이로 보여준다.
- 사용자와 친구가 함께 쓴다.

기존 방법으로는 거점 상자 속 아이템을 실시간으로 얻을 수 없어서 직접 만든다.

- 내장 REST API(8212): `info`, `players`, `metrics`, `settings`뿐이다.
- PalDefender REST(17993): 플레이어 위치, 팰, 인벤토리, 길드, 거점 일꾼 팰은 주지만 거점 구조물은 `"WIP"`이고 거점 상자 아이템은 없다.
- 세이브 파일 파싱: 실시간이 아니고, 현재 세이브 포맷(PlM)을 `palworld-save-tools` 0.24.0이 읽지 못한다.

## 용어

| 용어 | 설명 |
| --- | --- |
| 게임서버 | 팰월드 전용 서버(PalServer). |
| 모드 | 게임서버 프로세스 안에서 도는 UE4SS Lua 스크립트. 서버 메모리에서 거점 데이터를 읽어 JSON 파일로 쓴다. |
| 앱 | 게임 밖에서 도는 TS 기반 exe. 서버 부분과 클라 부분으로 구성된다. |
| 앱 서버 부분 | 모드 JSON과 PalDefender API를 합쳐 HTTP API로 제공한다. |
| 앱 클라 부분 | 서버 부분에 접속해 데이터를 받아 게임 창 위에 오버레이로 표시한다. 플레이어 PC의 팰월드와는 직접 소통하지 않는다. |

## 구조

```
[게임서버 + UE4SS + 모드 + PalDefender]
      │ base_storage.json (모드)        │ REST 17993 (PalDefender)
      ▼                                 ▼
[앱 서버 부분]  ── HTTP(토큰 인증) ──▶  [앱 클라 부분(오버레이)]
```

- 앱은 실행 옵션으로 `서버만`, `클라만`, `서버+클라` 3가지를 모두 지원한다.
- 게임서버를 띄우는 사람은 `서버+클라`, 친구는 `클라`로 실행한다.
- 게임서버 PC에서 게임서버와 앱 서버 부분이 둘 다 켜져 있어야 한다.
- 친구가 접속하려면 앱 서버 부분의 포트를 열거나 VPN을 써야 하며, 토큰 인증이 필수다.

## 구성 요소

### 게임서버 쪽 의존성

| 구성 요소 | 버전 | 위치 | 비고 |
| --- | --- | --- | --- |
| PalServer | v1.0.5.102999 (buildid 25247047) | `E:\Games\Steam\steamapps\common\PalServer` | Steam 도구판 |
| RE-UE4SS (Okaetsu 포크) | `Palworld (2281fa31)` | `Pal\Binaries\Win64\dwmapi.dll`, `ue4ss\` | 공식 UE4SS는 0.4.1.5 이후 팰월드에서 동작하지 않는다. |
| PalDefender | v1.9.3 | `Pal\Binaries\Win64\d3d9.dll`, `PalDefender.dll` | REST는 `127.0.0.1:17993`, Bearer 토큰 |

### 모드 (`mod/PalHelperMod`)

- 서버 시작 30초 뒤부터 10초마다 `base_storage.json`과 `status.json`을 모드 폴더에 쓴다.
- 쓰기 중인 파일을 읽지 않도록 임시 파일에 쓰고 이름을 바꾼다.
- 읽는 방법과 객체 연결 구조는 [game-internals.md](game-internals.md)에 정리했다.

`base_storage.json` 형식:

```json
{
  "version": 1,
  "updatedAt": 1791744000,
  "storages": [
    {
      "containerId": "D5A2D09F-406C826E-1BF0498E-5129A3C4",
      "group": "550A88ED-45A08C78-E5FA84BC-74F75B00",
      "kind": "chest",
      "modelClass": "PalMapObjectItemChestModel",
      "buildObjectId": "ItemChest",
      "location": { "x": -354871.4, "y": 259974.6, "z": 3986.5 },
      "slotCount": 10,
      "items": [{ "index": 0, "item": "Stone", "count": 81 }]
    }
  ]
}
```

- `group`: 길드 ID. PalDefender `/guilds`의 길드 ID와 같다.
- `kind`: `chest`, `guildChest`, `production`, `dropped`, `guildStorage`, `other`.
- `item`: 게임 내부 아이템 ID. 표시 이름 변환은 앱에서 한다.
- `location`: 건설한 건물만 있다. 바닥 드롭 등은 없다.

### 앱 (`app/`)

- 프레임워크: **Tauri v2**. 투명 창과 Windows 블러(Acrylic/Mica)를 지원하는 가장 가벼운 선택지로 정했다(2026-10-12). Electron은 무겁고, 더 가벼운 프레임워크는 블러를 지원하지 않는다.
- 화면: Vite + React + TS. palworld-helper와 같은 스택이다.
- 역할 분담(2026-10-12 결정):
  - **Rust**: 앱 서버 부분의 최소 기능만 둔다. HTTP 서버, 토큰 검사, 모드 JSON 읽기, PalDefender 중계. 데이터 가공은 하지 않는다.
  - **TS**: 데이터 합치기, 아이템 이름 변환, 오버레이 표시 등 로직 전부.
- 실행 옵션: `--mode server`(창 없이 API만), `--mode client`(오버레이만, 원격 서버에 접속), `--mode both`(둘 다).
- 오버레이는 게임이 테두리 없는 창 모드일 때 위에 표시된다. 전체화면 독점 모드에서는 보이지 않을 수 있다.

## 알려진 위험

- UE4SS를 서버에 설치하면 접속자가 새 캐릭터 생성 창을 만나는 버그가 보고되어 있다(UE4SS-RE/RE-UE4SS #836, #1091, #405). 현재 환경(1.0.5 + 2281fa31 + PalDefender)에서 기존 캐릭터 재접속은 정상임을 확인했다. 새 플레이어 첫 접속은 확인하지 않았다.
- 게임 업데이트로 클래스나 필드 이름이 바뀌면 모드가 깨질 수 있다.
- 실제 월드(협동 세이브)를 전용 서버로 옮기면 호스트 캐릭터 ID가 맞지 않는 문제가 있다. 현재 세이브 포맷을 읽는 ID 변환 도구가 없어서 이전은 보류 중이다.
