<p align="center">
  <img src="assets/icon.png" width="80" />
</p>

<h1 align="center">Stremio /DL</h1>

<p align="center">
  Batch download entire seasons and movies from Stremio addons.<br>
  Standalone executable — no runtime needed.
</p>

<p align="center">
  <a href="https://github.com/sickerine/stremio-dl/releases/latest">Download</a>
</p>

---

## Platform Setup

Downloaded binaries are unsigned. Your OS will block them by default.

### macOS

```sh
# Remove quarantine flag (run once after downloading)
xattr -cr ./stremio-dl-darwin-arm64

# Then run it
./stremio-dl-darwin-arm64
```

If you get "cannot be opened because the developer cannot be verified", go to **System Settings > Privacy & Security** and click **Open Anyway**.

### Windows

Windows SmartScreen will block the executable. Click **More info** > **Run anyway**.

Alternatively, right-click the `.exe` > **Properties** > check **Unblock** > **OK**.

### Linux

```sh
chmod +x ./stremio-dl-linux-x64
./stremio-dl-linux-x64
```

---

## Usage

### Executable (recommended)

Double-click the binary or run it with no arguments. It starts a local server and opens the web UI in your browser.

```sh
./stremio-dl
```

The dashboard runs at `http://localhost:9944`. From there:

1. **Search** for a series or movie in the left panel
2. **Click** a result to open the download modal
3. **Pick** season (series) or just quality (movies), toggle WEB-DL filter
4. **Download** — progress, speed, and file sizes are shown per-episode

Active downloads appear in the right panel with per-file speed and size tracking.

### First-time setup

Before downloading, configure your stream source:

1. Go to **Config** tab
2. Set your **Addon URL** — this is your Torrentio or StremThru URL

To get your addon URL from Stremio:
- Open Stremio > Settings > Addons > click your Torrentio/StremThru addon > copy the URL

Or set it via CLI:

```sh
./stremio-dl addon set "https://your-addon-url.example.com/manifest.json"
```

### Stremio Addon Integration

Stremio /DL registers itself as a Stremio addon. When the server is running:

1. Go to **Config** tab and click **Install** next to the addon URL
2. Stremio will open and ask to install the addon
3. Now when browsing any series or movie in Stremio, you'll see a **Stremio DL** stream option
4. Clicking it opens the download UI for that title

The addon works for both movies and series. For series, it shows "Download Season X" on each episode's stream list.

---

## CLI

The executable also works as a full CLI with subcommands.

### `search <query>`

Search for series and movies.

```sh
./stremio-dl search "breaking bad"
./stremio-dl search "inception" --type movie
```

| Option | Description |
|--------|-------------|
| `-t, --type <type>` | `series`, `movie`, or `all` (default: `all`) |

### `download <imdb_id>`

Download a season or movie by IMDB ID.

```sh
# Interactive — prompts for season, quality, etc.
./stremio-dl download tt0903747

# Non-interactive
./stremio-dl download tt0903747 -s 3 -q 1080p -y

# Specific episodes
./stremio-dl download tt0903747 -s 3 -e 1,2,3

# Movie
./stremio-dl download tt1375666 -q 1080p -y
```

| Option | Description |
|--------|-------------|
| `-s, --season <n>` | Season number (interactive if omitted) |
| `-q, --quality <q>` | `2160p`, `1080p`, `720p`, `480p` |
| `-b, --backend <b>` | `direct`, `debrid`, `qbittorrent` |
| `-o, --output <dir>` | Output directory |
| `-e, --episodes <list>` | Specific episodes (e.g., `1,2,3` or `1-5`) |
| `-a, --addon <url>` | Override addon URL for this download |
| `-y, --yes` | Skip confirmation prompts |

### `serve`

Start the server without opening the browser.

```sh
./stremio-dl serve --port 9944
```

### `config`

Manage persistent configuration.

```sh
./stremio-dl config show          # Show all settings
./stremio-dl config get debrid.apiKey
./stremio-dl config set download.outputDir ~/Movies
./stremio-dl config path          # Show config file location
./stremio-dl config reset         # Reset to defaults
```

### `addon`

Manage the stream addon URL.

```sh
./stremio-dl addon set "https://torrentio.strem.fun/sort=qualitysize/manifest.json"
./stremio-dl addon show
./stremio-dl addon reset
```

---

## Supported Backends

| Backend | How it works |
|---------|-------------|
| **Direct** | Downloads via URL (StremThru, debrid-resolved streams). Default when streams have direct URLs. |
| **Real-Debrid** | Resolves torrents through Real-Debrid API, then downloads unrestricted links. |
| **qBittorrent** | Adds torrents to a running qBittorrent instance. |

---

## Building from Source

Requires [Bun](https://bun.sh).

```sh
bun install
bun run build          # macOS (native)
bun run build:win      # Windows (cross-compile)
```

The build has two steps:
1. `bun run build:ui` — bundles the Preact UI into a single JS file
2. `bun build --compile` — compiles everything into a standalone executable

---

## License

MIT
