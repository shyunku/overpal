# Overpal

(formerly PalHelper; this repository is still named palworld-helper-mod)

Real-time base storage data for a Palworld dedicated server, shown as an in-game overlay.

- **Mod** (`mod/OverpalMod`): a UE4SS Lua mod that runs inside the dedicated server and writes every base storage container (chests, production buildings, guild storage, items dropped by players, and map pickups such as stones and berry bushes) with its items and world location to `base_storage.json` every 10 seconds.
- **App** (`app/`, in progress): a Tauri v2 executable. Its server part (Rust) serves the mod output and PalDefender data over token-authenticated HTTP; its client part (React + TypeScript) processes the data and draws the overlay windows (menu bar, item counts, minimap, settings) on top of the game.

## Requirements

- Palworld dedicated server (Windows), tested with v1.0.5.102999
- RE-UE4SS, Okaetsu fork, release `Palworld (2281fa31)`: https://github.com/Okaetsu/RE-UE4SS/releases
  - The upstream UE4SS build does not work with Palworld 0.4.1.5 and later.
- PalDefender v1.9.3 (optional, for player and guild data): https://github.com/Ultimeit/PalDefender/releases

## Installing the mod

1. Install UE4SS into `PalServer/Pal/Binaries/Win64` (`dwmapi.dll` and the `ue4ss` folder).
2. Copy `mod/OverpalMod` to `PalServer/Pal/Binaries/Win64/ue4ss/Mods/OverpalMod`.
3. Start the server. After about 30 seconds the mod writes `base_storage.json` and `status.json` into its folder.

## Running the app

1. Copy `app/overpal.config.example.json` to `overpal.config.json` and fill in the paths and tokens.
2. Run with one of the modes:
   - `--mode server`: HTTP API only, no window (on the PC that runs the dedicated server)
   - `--mode client`: overlay only, connects to `client.serverUrl`
   - `--mode both`: both in one process
3. The config is looked up from `--config <path>`, then `OVERPAL_CONFIG`, then next to the executable. The names from before the rename (`palhelper.config.json`, `PALHELPER_CONFIG`, the server folder `Mods/PalHelperMod`) are still read.

Release build: `cd app && pnpm tauri build` (from a Visual Studio developer prompt) writes `app/src-tauri/target/release/overpal.exe`, a single exe with the screens built in, and an installer `app/src-tauri/target/release/bundle/nsis/Overpal_<version>_x64-setup.exe` (per-user, no admin rights). Started without a config file it opens the profile window; with `overpal.config.json` next to it (or `--config`) it starts that config straight away.

Every release raises the version first (patch number for fixes and small changes), in `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml` and `app/package.json`. The title bar shows it.

Development: `cd app && pnpm install && pnpm tauri dev`. On Windows, run it from a Visual Studio developer prompt (`vcvars64.bat`); see `docs/cautions.md`.

## Known risks

- Installing UE4SS on a dedicated server has been reported to make players create a new character on join (RE-UE4SS issues #836, #1091). It did not happen in our test environment, but back up your world before installing.
- Game updates can rename the classes and fields the mod reads. See `docs/game-internals.md`.

## Documentation

- `docs/project.md`: goals, terminology, architecture, output format
- `docs/game-internals.md`: how the mod finds base storage in server memory
- `docs/tasks.md`: task list
- `docs/cautions.md`: development and test server notes
