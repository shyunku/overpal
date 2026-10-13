# 유의사항

## 개발 환경

- Rust 빌드는 **Visual Studio 개발자 환경**(`vcvars64.bat`)을 불러온 뒤에 해야 한다. PATH에 Git의 `C:\Program Files\Git\usr\bin\link.exe`가 먼저 잡혀서, 그냥 `cargo`를 실행하면 링크 단계에서 `extra operand` 에러로 실패한다.

  ```bat
  "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
  set PALHELPER_CONFIG=E:\Workspace\Private\Labs\palworld-helper-mod\.local\palhelper.config.json
  cd app
  pnpm tauri dev
  ```

- 앱 설정 파일은 `--config <경로>`, 환경 변수 `PALHELPER_CONFIG`, exe 옆 `palhelper.config.json`, 현재 폴더 순으로 찾는다.
- 실제 설정과 토큰은 `.local/`(git 제외)에 둔다. `app/palhelper.config.example.json`이 형식 예시다.
- 빌드 로그의 `linker stdout: ... 라이브러리 및 ... 개체를 생성하고 있습니다` 경고는 MSVC 정보 메시지라 무시해도 된다.

## 테스트 서버

- 위치: `E:\Games\Steam\steamapps\common\PalServer`. 테스트 월드는 `84F36FA5...`이고 사용자의 실제 월드(`FF88CE01...`, 협동 세이브)와 무관하다.
- 모드를 바꾸면 `.local/redeploy.ps1 -AdminPwFile .local/secrets/admin_pw.txt`로 복사, 저장, 종료, 옛 출력 삭제, 재시작을 한 번에 한다.
- 서버 재시작은 접속 중인 플레이어를 끊는다. 저장 후 종료하므로 데이터는 유지된다.
- 옛 출력 파일은 서버가 완전히 꺼진 뒤에 지워야 한다. 종료 직전에 모드가 파일을 다시 쓸 수 있다.
- 서버가 켜져 있는 동안 내장 REST(8212)는 `0.0.0.0`으로 열려 LAN에서 접근 가능하다(관리자 비밀번호 필요). PalDefender REST(17993)와 앱 서버 부분(17994)은 `127.0.0.1`만 연다.
- UE4SS 설치 전 월드 백업: `.local/backup_world_before_ue4ss/`

## 오버레이 창

- 패널 배경 블러는 Windows의 예전 Acrylic(`SetWindowCompositionAttribute`, accent 4)로 건다. Windows 11 빌드 26200에서 확인한 결과:
  - Tauri `Acrylic`(DWM 시스템 배경)은 창이 비활성이면 단색이 되는데, 오버레이 창은 늘 비활성이라 항상 불투명했다.
  - Tauri `Blur`는 웹뷰 아래에서 검은 단색으로 그려졌다.
  - 창 그림자(`shadow`)를 켜면 투명 처리가 깨질 수 있어 끈다. 그래서 Windows가 창 모서리를 둥글게 처리하지 않는다.
- 비교용 환경 변수: `PALHELPER_EFFECT=none|blur|acrylic`(기본은 예전 Acrylic), `PALHELPER_FORCE_CLICK_THROUGH=1`(플레이 중처럼 항상 클릭 통과). `.local/try-effect.ps1`이 이 값들로 앱을 띄워 `.local/capture-overlay.ps1`로 창 영역을 캡처한다.
- 클릭 통과는 창을 `WS_EX_LAYERED | WS_EX_TRANSPARENT`로 바꾸는 방식(tao)이다. 이 상태에서도 예전 Acrylic 블러는 유지된다.
- 표시 규칙: 팰월드(`Palworld-Win64-Shipping.exe`) 창보다 z-order가 위인 창들의 영역(DWM 확장 프레임 기준)을 64×36 격자로 샘플링해 10% 이상 가려지면 숨긴다. 보이지 않거나 최소화되거나 cloaked(다른 가상 데스크톱 등)인 창, 팰월드와 이 앱의 창, `WS_EX_TRANSPARENT` 창은 제외한다. 오버레이는 팰월드가 있는 모니터에 뜬다.

## 모드 성능

- 모드는 10초마다 게임 스레드에서 실행된다. 한 번 실행 시간이 2026-10-12 기준 60~70ms였고, 바닥 아이템 좌표 조회를 추가한 뒤 131ms가 됐다(`status.json`의 `elapsedMs`). 이 동안 서버 프레임이 멈출 수 있다. 거점과 컨테이너가 많아지면 최적화가 필요하다.

- 모드의 루프에 `LoopAsync`(+ `ExecuteInGameThread`)를 쓰면 안 된다. `LoopAsync` 콜백은 다른 스레드에서 돌면서 게임 스레드의 훅 콜백과 같은 Lua 상태를 건드린다. 250ms 루프로 바꾼 뒤 `Ref was not function` 같은 Lua 오류가 몇 분마다 찍히다가 서버가 UE4SS 안에서 접근 위반으로 죽었다(2026-10-12 10:39 KST). `LoopInGameThreadWithDelay`로 바꾼 뒤로는 오류가 없다.

- 팰월드 서버를 REST로 끄면 프로세스는 종료되지만 콘솔 창(Windows Terminal)이 열려 있는 동안 프로세스 목록에 남는다(`HasExited`=True). `redeploy.ps1`은 종료된 프로세스를 무시한다. 남은 창은 닫으면 된다.
- 모드의 `BUILD_NET_UPDATE_HZ`는 서버 시작 때만 효과가 있다. 값을 바꾸면 서버를 재시작해야 한다.

## 실제 월드 이전 (#12)

- 협동 월드를 전용 서버로 옮길 때 원본(`%LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID>\<월드>`)은 읽기만 한다. 복사본을 `.local/backups`와 서버 `SaveGames/0/<월드>`에 두고 `GameUserSettings.ini`의 `DedicatedServerName`을 바꾼다.
- 전용 서버는 월드 폴더에 `WorldOption.sav`가 있으면 `PalWorldSettings.ini` 대신 그것을 쓴다. 협동 월드의 것은 REST가 꺼져 있고 관리자 비밀번호가 비어 있다. `scripts/world_option_to_ini.py`로 게임 규칙만 ini에 옮기고(서버 이름·비밀번호·포트·REST·RCON·인증·크로스플레이는 서버 값 유지) 서버 쪽 복사본에서 `WorldOption.sav`를 지운다. 적용 값은 REST `/v1/api/settings`로 확인한다.
- 협동 호스트는 항상 `00000000-…-00000001`이다. 전용 서버에서 한 번 접속해 임시 캐릭터를 만든 뒤 서버를 끄고, Palworld Save Pal(v1.4.3, `E:GamesPalworld	oolspalworld-save-pal`, 사본 `.local/tools/palworld-save-pal`)의 Player UID Swap으로 `…0001`과 내 ID(`E5EEB250…`)를 맞바꾼다. 친구 ID는 협동과 전용 서버가 같아서 그대로 이어진다.
- 친구와 할 때는 그 시점의 A로 위 과정을 다시 한다. 그 뒤로 A를 플레이하면 두 월드가 갈라진다.
- 지도 밝힌 기록은 서버가 아니라 각 플레이어 PC의 `SaveGames\<SteamID>\<월드 ID>\LocalData.sav`에 있다. 전용 서버의 월드 ID가 협동 월드와 같으면, 호스트가 서버에 처음 접속할 때 협동 월드 폴더의 `LocalData.sav`를 새것으로 덮어써 지도가 비어 보인다(손님이던 친구는 그대로 이어진다). 옮기기 전에 백업해 두고, 게임을 끈 상태에서 원래 파일을 다시 넣으면 돌아온다(2026-10-12 확인).

## 서버 환경 (2026-10-13)

| | 위치 | 월드 ID | 용도 |
| --- | --- | --- | --- |
| A | 이 PC 협동 세이브 `SaveGames\<SteamID>\FF88CE01…` | `FF88CE01…` | 원본 보관, 더 플레이하지 않음 |
| B | `E:\Games\Steam\steamapps\common\PalServer` | `7EEC10A2940A4812ADCE889EF63DB5C2` | 테스트. 개발 앱(`.local/palhelper.config.json`)과 `redeploy.ps1` 기본값 |
| C | `E:\Games\Palworld\servers\Pyundle261012-fork` | `FF88CE01…` | 친구와 하는 실제 서버. 앱은 `mod_apps\host`, 친구용은 `mod_appsriends\<이름>` |

- B와 C는 포트(8211, 8212, 17993, 17994)가 같아 동시에 켤 수 없다.
- B는 C와 지도 기록(`LocalData.sav`)이 섞이지 않게 월드를 새 ID 폴더로 복사해 쓴다(원래 `FF88CE01…` 폴더는 B에 그대로 있다).
- 모드는 B에서 확인한 뒤 `redeploy.ps1 -Server <C 경로>`로 C에 넣는다.

## 화면 개발

- 패치 스크립트로 파일을 여러 번 나눠 쓰면 vite가 중간 상태를 핫 리로드해 창이 오류 상태로 남을 수 있다(예: `match is not defined`). 앱만 재시작해서는 풀리지 않았고 vite를 다시 띄워야 했다.

## 관찰했지만 원인을 모르는 것

- 서버 재시작 전후로 상자의 빨간 열매가 13에서 14로 늘었다. 저장 시점 값이 다시 불러와진 것으로 추정하지만 확인하지 않았다.
