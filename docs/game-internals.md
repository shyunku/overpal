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

## 검증 기록

- 2026-10-12 03:42 KST: 사용자가 알려준 상자 내용(돌 81, 팰지움 파편 58, 빨간 열매 15, 나무 12, 열매 씨앗 10, 팰스피어 2)과 모드 출력이 일치했다. 빨간 열매는 부패로 14, 13으로 줄어드는 것이 반영됐다.
- 2026-10-12 03:51 KST: 사용자가 상자에서 돌 1개, 팰지움 파편 58개를 꺼내고 양털 5개를 넣은 변화가 10초 이내에 출력에 반영됐다.
- 4개 상자 모두 컨테이너와 월드 좌표가 연결됐다.

## 아이템 ID 주의

- 게임 내부 ID와 palworld-helper 프로젝트(`paldb` 기반) ID가 다른 것이 있다. 예: 팰지움 파편은 내부 `Pal_crystal_S`, 프로젝트 `Paldium_Fragment`.
- 내부 ID 목록은 클라이언트 팩의 `Pal/Content/Pal/DataTable/Item/DT_ItemDataTable` 이름 테이블에서 볼 수 있다.

## 미확인

- 플레이어 체력 등 캐릭터 상태 필드는 조사하지 않았다.
- 길드 상자(`PalMapObjectGuildChestModel`)는 테스트 월드에 없어서 실제 출력을 확인하지 않았다.
