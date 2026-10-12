# 게임 내부 구조 조사 기록

모드가 서버 메모리에서 데이터를 읽는 방법을 정리한다. 게임 업데이트로 모드가 깨지면 이 문서를 기준으로 다시 찾는다.

- 조사 환경: PalServer v1.0.5.102999, RE-UE4SS `Palworld (2281fa31)`, 2026-10-12 KST
- 조사 방법: UE4SS Lua의 `ForEachUObject`, `FindAllOf`, `UStruct:ForEachProperty`로 클래스와 필드를 덤프했다.

## 아이템 컨테이너

| 클래스 | 필드 | 설명 |
| --- | --- | --- |
| `PalItemContainer` | `ItemSlotArray` (Array of `PalItemSlot`) | 슬롯 목록 |
| | `ID.ID` (Guid A/B/C/D) | 컨테이너 ID |
| | `BelongInfo.GroupId` (Guid) | 소속 길드 ID. 0이면 월드 보물상자, 플레이어 인벤토리 등 |
| | `OwnerMapObjectInstanceId` (Guid) | 소유 구체 모델의 `InstanceId` |
| | `bIsGuildChestContainer` | 길드 상자 여부 |
| `PalItemSlot` | `SlotIndex`, `StackCount` | 슬롯 번호, 개수 |
| | `ItemId.StaticId` (Name) | 아이템 ID. 예: `Stone`, `Pal_crystal_S` |
| | `ContainerId.ID` (Guid) | 소속 컨테이너 ID |

- `PalItemContainerManager.ItemContainerMap_InServer`에 서버의 모든 컨테이너가 있다. 모드는 `FindAllOf("PalItemContainer")`로 직접 찾는다.
- Guid의 A/B/C/D는 부호 있는 int로 읽힌다. `& 0xFFFFFFFF`로 변환해야 PalDefender의 표기와 같아진다.

## 컨테이너 → 건물 → 좌표 연결

```
PalMapObjectItemContainerModule.TargetContainer  → PalItemContainer
PalMapObjectItemContainerModule:GetOuter()       → 구체 모델(PalMapObject*Model)
구체 모델.InstanceId        == 컨테이너.OwnerMapObjectInstanceId
구체 모델.ModelInstanceId   == 건물 액터(PalBuildObject).ModelInstanceId
건물 액터:K2_GetActorLocation()                → 월드 좌표
```

- 바닥에 버린 아이템도 같은 방식으로 연결된다. 액터 클래스는 `PalMapObjectCommonDropItem3D`(`BP_MapObject_CommonDropItem3D_C`)이다.

- 건물 액터의 `MapObjectModel.InstanceId`는 액터의 `ModelInstanceId`와 같고, 구체 모델의 `InstanceId`와는 다르다. 처음에 이걸로 연결하려다 실패했다.

## 구체 모델 클래스와 의미

| 클래스 | 의미 | 모드의 `kind` |
| --- | --- | --- |
| `PalMapObjectItemChestModel` | 상자(나무 궤짝 등) | `chest` |
| `PalMapObjectGuildChestModel` | 길드 상자 | `guildChest` |
| `PalMapObjectConvertItemModel` | 제작 건물 보관함. 완성품과, 걸려 있는 주문 중 아직 만들지 않은 분의 재료가 함께 들어 있다 | `production` |
| `PalMapObjectDropItemModel` | 플레이어가 바닥에 버린 아이템. 버린 묶음마다 컨테이너 하나. 거점 근처에서 버리면 길드 소속으로 잡힌다 | `dropped` |
| `PalMapObjectPickupItemOnLevelModel` | 맵에 배치된 줍기 아이템(작은 돌, 나뭇가지, 열매 덤불). 플레이어가 보관한 것이 아님 | `pickup` (합계에서 제외) |
| `BP_MapObjectTreasureBoxModel_C`, `PalMapObjectTreasureBoxModel` | 월드 보물상자(길드 소속 아님) | 제외 |

- 모듈 없이 길드 소속인 컨테이너가 하나 있다(54칸). 길드 단위 공용 창고로 보이며 PalDefender `/guild`의 `items` 컨테이너와 ID가 같다. 모드는 `guildStorage`로 표시한다.

## 변경 감지 훅

- `/Script/Pal.PalMapObjectItemContainerModule:OnUpdateContents`에 `RegisterHook`을 걸면 컨테이너 내용이 바뀔 때 호출된다. `self:get().TargetContainer.ID.ID`로 바뀐 컨테이너를 알 수 있다.
- 상자는 내용이 그대로여도 약 1초마다 한 번씩 호출된다. 그래서 모드는 훅을 "다시 읽을 후보" 표시로만 쓰고, 다시 읽은 내용이 이전과 같으면 파일을 쓰지 않는다.
- `OnUpdateSlotContent`는 훅을 걸어도 호출되지 않았다.
- 훅 대상 클래스는 월드가 로드된 뒤에 생기므로, 첫 전체 스캔 때 훅을 건다.

## 작업 진행도 복제 (#13)

건설·제작 진행 바가 전용 서버에서 1초에 약 3번 툭툭 오르는 원인을 2026-10-12에 확인하고 모드로 개선했다. 서버와 클라이언트 양쪽에 UE4SS를 붙여 측정했다. 측정 로그는 `.local/probes/progress_*_2026-10-12.txt`에 있다.

- 진행도는 `PalWorkProgress`(outer는 `BP_PalWorkProgressManager_C`)의 `CurrentWorkAmount`이고, 일반 복제 변수(`OnRep_CurrentWorkAmount`)로 클라에 간다. 진행 속도 `ReplicatedWorkAmountBySec`도 함께 복제된다(감시대 건설 때 540~600).
- 서버: 진행량이 약 0.08초 간격으로 매끄럽게 오른다.
- 클라: `OnRep_CurrentWorkAmount`가 약 0.34초 간격(초당 약 3번)으로 온다. 받는 사이에는 클라의 `CurrentWorkAmount`가 바뀌지 않는다(클라 예측 없음). 진행 바는 받은 값을 보간 없이 그리므로 "띡-띡-띡" 하고 오른다.
- 0.34초 주기의 근거:
  - 서버는 `PalReplicationGraph`를 쓰고 그래프는 초당 30번 돈다(`Net.RepGraph.Frequency.Override`=30. `DefaultEngine.ini`에는 20이지만 실행 중 값은 30).
  - 진행도 객체는 클라에서 건물 액터 밑에 생긴다(예: `BP_BuildObject_BaseCampWorkHard_C_...PalWorkProgress_...`). 진행도는 건물 액터가 복제한다.
  - `PalBuildObject`의 클래스 기본값(CDO) `NetUpdateFrequency`가 3이고 건물 블루프린트 클래스가 이를 물려받는다. 복제 그래프는 클래스를 처음 볼 때 이 값으로 주기를 정한다. 30 / 3 = 10프레임 = 0.33초로 측정값과 맞는다.
  - 진행량 setter(`0x14321EC30`, 서버 exe)는 값만 쓰고 푸시 모델 dirty 표시를 하지 않는다. 일반 속성 비교 방식으로 복제된다.
  - 서버 네트워크 틱레이트(`NetServerMaxTickRate`=60)와 대역폭은 원인이 아니다.
- 효과가 없었던 것(모두 서버 실행 중에 변경): 건물 액터·GameState·`PalNetworkTransmitter`의 `NetUpdateFrequency`, 건물 클래스 CDO(클래스를 이미 본 뒤), `Net.RepGraph.SetPeriodFrame`(GameState, `BP_BuildObject`), `Net.RepGraph.Frequency.Override` 60, `PalRepGraph.DynamicActorFrequencyBuckets` 1.
- 해결(모드 `BUILD_NET_UPDATE_HZ`): 모드가 로드되자마자(건물 클래스와 복제 그래프가 생기기 전) `PalBuildObject` CDO의 `NetUpdateFrequency`를 20으로 올린다. 클라 수신 간격이 0.35초에서 0.05초(초당 약 20번)로 줄었다. 클라는 건드리지 않는다.
  - 건물 액터 자체의 `NetUpdateFrequency`는 여전히 3으로 보인다. 주기를 정하는 것은 클래스 기본값이다.
  - 값별 측정(클라 수신 간격): 10 → 0.099초, 20·30·40 → 0.050초. 20까지는 설정값을 그대로 따르고 그 위는 초당 20번에서 막힌다. 막히는 곳은 확인하지 않았다(서버 3프레임마다 = 60fps 기준 20번). 그래서 부담이 가장 적으면서 상한을 쓰는 20을 쓴다.
  - 모든 건물(완성된 벽·바닥 포함)이 더 자주 복제 검사 대상이 된다. 바뀌지 않은 건물은 보낼 데이터가 없어 네트워크는 거의 늘지 않고 서버 CPU만 조금 더 쓴다. 테스트 월드(건물 9개)에서 서버 FPS는 60 그대로였다. 큰 거점에서는 확인하지 않았다.
- 협동(초대) 방식도 같은 코드와 설정을 쓰므로 초대받은 사람은 같은 끊김을 봤을 것으로 본다(확인하지 않음). 호스트는 서버 안에서 직접 보므로 연속으로 보인다.
- 서버는 Shipping 빌드라 로그가 남지 않는다. 복제 그래프 콘솔 명령(`PalRepGraph.PrintRouting` 등)의 출력은 볼 수 없었다.

## 검증 기록

- 2026-10-12 03:42 KST: 사용자가 알려준 상자 내용(돌 81, 팰지움 파편 58, 빨간 열매 15, 나무 12, 열매 씨앗 10, 팰스피어 2)과 모드 출력이 일치했다. 빨간 열매는 부패로 14, 13으로 줄어드는 것이 반영됐다.
- 2026-10-12 03:51 KST: 사용자가 상자에서 돌 1개, 팰지움 파편 58개를 꺼내고 양털 5개를 넣은 변화가 10초 이내에 출력에 반영됐다.
- 4개 상자 모두 컨테이너와 월드 좌표가 연결됐다.

## 아이템 ID 주의

- 게임 내부 ID와 palworld-helper 프로젝트(`paldb` 기반) ID가 다른 것이 있다. 예: 팰지움 파편은 내부 `Pal_crystal_S`, 프로젝트 `Paldium_Fragment`.
- 내부 ID 목록은 클라이언트 팩의 `Pal/Content/Pal/DataTable/Item/DT_ItemDataTable` 이름 테이블에서 볼 수 있다.

## 아이템 이름 테이블

- 한국어 이름: 클라이언트 팩의 `Pal/Content/L10N/ko/Pal/DataTable/Text/DT_ItemNameText_Common`. 행 이름이 `ITEM_NAME_<게임 ID>`다.
- 팰월드는 "버전 없는 속성(unversioned properties)"으로 쿡되어 속성 이름이 파일에 없다. 텍스트 테이블은 행마다 FText 하나뿐이라 구조 정보 없이 읽을 수 있다(`scripts/ue_datatable.py`). 아이템 데이터 테이블(`DT_ItemDataTable`, 아이콘 이름 포함)은 구조 정보가 없으면 읽을 수 없어서 아이콘은 palworld-helper에서 이름이 같은 아이템으로 맞춘다.
- 번역되지 않은 행은 값이 `ko_Text`다. 무기·방어구의 등급 변형(`ClothArmor_3` 등)은 기본 아이템 이름을 쓴다.
- 추출: `.local/tools/repak/repak.exe unpack <Pal-Windows.pak> -i "Pal/Content/L10N/ko/Pal/DataTable/Text/DT_ItemNameText_Common*" -o .local/gamedata` (Oodle 압축 해제에 `oo2core_9_win64.dll` 필요).

## 미확인

- 플레이어 체력 등 캐릭터 상태 필드는 조사하지 않았다.
- 길드 상자(`PalMapObjectGuildChestModel`)는 테스트 월드에 없어서 실제 출력을 확인하지 않았다.
