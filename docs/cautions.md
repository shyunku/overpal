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

## 관찰했지만 원인을 모르는 것

- 서버 재시작 전후로 상자의 빨간 열매가 13에서 14로 늘었다. 저장 시점 값이 다시 불러와진 것으로 추정하지만 확인하지 않았다.
