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

## 화면 개발

- 패치 스크립트로 파일을 여러 번 나눠 쓰면 vite가 중간 상태를 핫 리로드해 창이 오류 상태로 남을 수 있다(예: `match is not defined`). 앱만 재시작해서는 풀리지 않았고 vite를 다시 띄워야 했다.

## 관찰했지만 원인을 모르는 것

- 서버 재시작 전후로 상자의 빨간 열매가 13에서 14로 늘었다. 저장 시점 값이 다시 불러와진 것으로 추정하지만 확인하지 않았다.
