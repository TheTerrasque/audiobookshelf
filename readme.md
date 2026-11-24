<br />
<div align="center">
   <img alt="Audiobookshelf Banner" src="https://github.com/advplyr/audiobookshelf/raw/master/images/banner.svg" width="600">

  <p align="center">
    <br />
    <a href="https://audiobookshelf.org/docs">Documentation</a>
    ·
    <a href="https://audiobookshelf.org/support">Support</a>
    ·
    <a href="https://audiobooks.dev/">Demo</a>
  </p>
</div>

## ⚠️ Frontend pull requests are not being reviewed or merged for the existing Vue frontend. The frontend is currently being rewritten and migrated to React and should be available soon.

# About this fork

> [!NOTE]
> **This is an unofficial fork** of [advplyr/audiobookshelf](https://github.com/advplyr/audiobookshelf). It's not affiliated with or supported by the Audiobookshelf project. All fork changes are collected on the `fork` branch (the default branch here), which is rebased on upstream regularly: currently v2.38.2 on top of upstream v2.38.0.
>
> The database migrations only add columns and a table, but switching to this fork is still a one-way step: going back to official releases is untested.

## Extra features

### Comics

- **Big comics open instantly.** CBZ and CBR pages are served one at a time by the server instead of the browser downloading and unpacking the whole archive. Pages are cached in memory and the next page is preloaded, so paging back and forth is fast.
- **A better comic reader.** Fit to screen (the default), fit to width or custom zoom (10–400%, also with the mouse wheel), black, dark or white background, and scrolling back to the top on each new page (can be turned off).
- **Quick navigation.** Click the page counter for a numbered list of pages to jump to, or the file counter for a list of the book's comic files. An info button shows the comic's ComicInfo.xml details when it has them.
- **Series in one book.** A book with several comic files (one per volume, say) reads straight through: going past the last page of one file opens the next, and going back from the first page opens the end of the previous one.
- **Put the files in order.** **Reorder** in a book's Ebook Files list sets the reading order by drag and drop, or tick several files and move them to the top or bottom in one go (handy for series with dozens of files).
- **Resume in the right volume.** Reading progress remembers which file you were in, on the web and in the app fork, and overall progress keeps growing as you move through the volumes instead of starting over at each one.
- **Format filter.** Filter a library by audiobook, ebook or comic.
- **Older books work fully.** Books scanned before the ebook format was recorded open as comics and show up in Continue Reading.

### Audio versions

- **Your library files are never modified.** The M4B encoder and "embed metadata" save their output as a separate *version* of the book in a version store, so library folders can be mounted read-only and the originals are always kept.
- **Name your versions.** Give a version a name when you create it on the tools page (for example "Car mix" or "1.5x"). The item page lists the versions with the encoder settings each was made with.
- **Pick which version you listen to.** Each user chooses a version per book on the item page (or in the app fork). Streaming, transcoding, downloads and the mobile app all use it. Admins can rename and delete versions.
- **Clean up the audio while encoding.** The M4B encoder can normalize loudness (EBU R128, with adjustable target, true peak and range), compress dynamic range, add a voice clarity EQ, reduce noise, and change speed from 0.5× to 3× without changing pitch. Chapters are adjusted to match. These options need re-encoding, so they can't be combined with the Copy codec.
- **Split a book into parts.** The M4B encoder can cut its result into parts of 15, 30 or 60 minutes (or any length), moving each cut to a nearby chapter start. Players play the parts back to back as one book. With the [app fork](https://github.com/TheTerrasque/audiobookshelf-app) you can start listening offline as soon as the first parts are downloaded, and delete parts you've already heard to save space on the phone. Works with the Copy codec too, so an existing M4B can be split without re-encoding.
- **Sped-up versions keep your place.** Progress and bookmarks stay on the original timeline and are converted for the version you've picked, including offline listening from a downloaded copy, so switching versions never loses your position.

### Mobile app

- **Connect the app with a QR code.** **Account → Connect Mobile App** shows a QR code. Scan it with your phone and the [app fork](https://github.com/TheTerrasque/audiobookshelf-app) opens with the server address and your username filled in; you only enter your password. The code contains no credentials.
- **A matching app.** The [app fork](https://github.com/TheTerrasque/audiobookshelf-app) reads comics page by page from this server, follows multi-file comics and can reorder their files, has the format filter and the audio version picker, scans the QR codes, and fixes epub page turning and progress on phones.

### Hosting

- **Ready-made Docker images** for amd64 and arm64 on GitHub Container Registry, built from every push. See [Running the fork with Docker](#running-the-fork-with-docker).
- **A separate version store** for the audio versions. See [Hosting the version store](#hosting-the-version-store).

### Reliability and security

- **Safe CBR extraction.** File names inside a CBR archive can't escape its temporary folder (zip-slip), and each open archive gets its own folder, so two comics read at the same time can't overwrite each other's pages.
- **Steady under load.** Several readers on the same comic share one open archive, an archive is never closed while a page is being read from it, and deleting a book clears its cached pages.
- **No wrong pages after switching volumes.** A slow page that arrives after you've moved to another file is discarded instead of being shown in the new one.

<details>
<summary>Technical details (API, settings, migrations)</summary>

- **Comic pages API:** `GET /api/items/:id/ebook/:fileid?/pages` returns the page list and ComicInfo.xml metadata; `GET /api/items/:id/ebook/:fileid?/pages/:page` returns one page image (1-based).
- **Comic page cache:** an in-memory LRU sized in bytes (`COMIC_PAGE_CACHE_MAX_BYTES`, default 64 MB) and a pool of open archives (`COMIC_EXTRACTOR_POOL_MAX`, default 4). CBZ files are streamed; CBR files are unpacked into a temp directory per archive, protected against entries escaping it (zip-slip).
- **Comic file order:** `PATCH /api/items/:id/ebook`. Per-file progress is stored in `mediaProgresses.ebookFileIno` (migration `v2.38.1`).
- **Versions:** stored under `VERSIONS_PATH` (default `<METADATA_PATH>/versions`). `GET/PATCH/DELETE /api/items/:id/versions[/:versionId]` (rename and delete are admin only), `PATCH /api/me/item/:id/version` to choose one. Migration `v2.38.2-add-media-versions`.
- **Split into parts:** `partMinutes=<1-600>` on `POST /api/tools/item/:id/encode-m4b`. The encoded m4b is cut with ffmpeg's segment muxer (`-c copy`, no re-encode, gapless) into `<book> - Part NN.m4b` files of one version; the version's `options` record `partMinutes` and `parts`.
- **Quick connect link:** `audiobookshelf://connect?address=<server url>&username=<username>`.

</details>


## Running the fork with Docker

Images are built by [`docker-build-fork.yml`](.github/workflows/docker-build-fork.yml) on every push and published to GitHub Container Registry:

| Tag | What it is |
|---|---|
| `ghcr.io/theterrasque/audiobookshelf:latest` | Latest build of the `fork` branch, with all fork features. **Use this one.** |
| `ghcr.io/theterrasque/audiobookshelf:<branch>` | Latest build of another branch, with `/` replaced by `-`, e.g. `:feat-something` for a feature still in progress |
| `ghcr.io/theterrasque/audiobookshelf:sha-<commit>` | A specific commit, e.g. `:sha-92f5ef3` |

Use it in place of the official image in the example [`docker-compose.yml`](docker-compose.yml). Everything else (ports, `/config`, `/metadata`, library mounts) works as in upstream.

```yaml
services:
  audiobookshelf:
    image: ghcr.io/theterrasque/audiobookshelf:latest
    ports:
      - 13378:80
    volumes:
      - ./audiobooks:/audiobooks:ro # library folders can be read-only
      - ./podcasts:/podcasts
      - ./metadata:/metadata
      - ./config:/config
      - ./versions:/versions # file versions (re-encodes, embedded metadata)
    environment:
      - VERSIONS_PATH=/versions
    restart: unless-stopped
```

To build it yourself: `docker build -t audiobookshelf-fork .`

## Hosting the version store

The M4B encoder and "embed metadata" tools never write into library folders. Each run creates a *version* in the version store instead, so the library can be mounted read-only and the originals are always kept.

**Where it lives.** The store is the directory in `VERSIONS_PATH`. If that isn't set it's `<METADATA_PATH>/versions` (`/metadata/versions` in Docker), which works but mixes large audio files into the metadata folder. A separate volume is recommended:

```yaml
    volumes:
      - /srv/abs-versions:/versions
    environment:
      - VERSIONS_PATH=/versions
```

Outside Docker, set the `VERSIONS_PATH` environment variable or pass `--versions <path>`.

**Layout.** The store mirrors your libraries, one folder per version:

```
/versions/<library name>/<item path inside the library folder>/<version label>/
    <audio files>
    version.json   # label, tool and its settings, item path and title, duration, chapters, files
```

**Things to know when hosting it:**

- **Space.** A version is a full copy of the audio (an M4B re-encode is about the size of the original at the chosen bitrate), so size the volume like a second library for the books you convert. The M4B encoder first writes to the item cache under `METADATA_PATH` and moves the finished file into the store, so the metadata disk also needs room for one book at a time.
- **Permissions.** The server process (the container user, or the `user:` set in compose) needs read/write access. The directory is created on startup if it doesn't exist.
- **Keep the path inside the container stable.** Versions are recorded in the database by their full path, e.g. `/versions/Audiobooks/…`. You can move the data on the host freely, but keep mounting it at the same container path and keep `VERSIONS_PATH` the same, or the server won't find existing versions.
- **Backups.** Audiobookshelf's built-in backups contain the database (including the list of versions) but not the version files. Back up the store separately if you want to keep re-encodes; the originals in the library are never changed.
- **Removing items.** Deleting a library item removes its versions from the database but leaves the folders in the store, so nothing is lost by accident; clean those up by hand if you want the space back. Deleting a version from the item page (admins only) removes its folder. The server only ever deletes directories inside `VERSIONS_PATH`.
- **Docker gotcha.** Don't mount anything at `/lib` in the Alpine image: it hides the system libraries and the container won't start.

# About

Audiobookshelf is a self-hosted audiobook and podcast server.

### Features

- Fully **open-source**, including the [android & iOS app](https://github.com/advplyr/audiobookshelf-app) _(in beta)_
- Stream all audio formats on the fly
- Search and add podcasts to download episodes w/ auto-download
- Multi-user support w/ custom permissions
- Keeps progress per user and syncs across devices
- Auto-detects library updates, no need to re-scan
- Upload books and podcasts w/ bulk upload drag and drop folders
- Backup your metadata + automated daily backups
- Progressive Web App (PWA)
- Chromecast support on the web app and android app
- Fetch metadata and cover art from several sources
- Chapter editor and chapter lookup (using [Audnexus API](https://audnex.us/))
- Merge your audio files into a single m4b
- Embed metadata and cover image into your audio files
- Basic ebook support and ereader
  - Epub, pdf, cbr, cbz
  - Send ebook to device (i.e. Kindle)
- Open RSS feeds for podcasts and audiobooks

Is there a feature you are looking for? [Suggest it](https://github.com/advplyr/audiobookshelf/issues/new/choose)

Join us on [Discord](https://discord.gg/HQgCbd6E75)

### Demo

Check out the web client demo: https://audiobooks.dev/ (thanks for hosting [@Vito0912](https://github.com/Vito0912)!)

Username/password: `demo`/`demo` (user account)

### Android App (beta)

Try it out on the [Google Play Store](https://play.google.com/store/apps/details?id=com.audiobookshelf.app)

### iOS App (beta)

**Beta is currently full. Apple has a hard limit of 10k beta testers. Updates will be posted in Discord.**

Using Test Flight: https://testflight.apple.com/join/wiic7QIW **_(beta is full)_**

<br />

<img alt="Library Screenshot" src="https://github.com/advplyr/audiobookshelf/raw/master/images/DemoLibrary.png" />

<br />

# Organizing your media

#### Directory structure and folder names are important to Audiobookshelf!

See [library docs](https://audiobookshelf.org/docs/category/libraries) for supported directory structures, folder naming conventions, and audio file metadata usage.

<br />

# Installation

See [install docs](https://audiobookshelf.org/docs/category/installation)

<br />

# Reverse Proxy Set Up

#### Important! Audiobookshelf requires a websocket connection.

#### Note: Using a subfolder is supported with no additional changes but the path must be `/audiobookshelf` (this is not changeable). See [discussion](https://github.com/advplyr/audiobookshelf/discussions/3535)

See [reverse proxy docs](https://audiobookshelf.org/docs/category/reverse-proxy)

<br />

# Contributing

See [contributing docs](https://audiobookshelf.org/docs/contributing/general/)

### Localization

Thank you to [Weblate](https://hosted.weblate.org/engage/audiobookshelf/) for hosting our localization infrastructure pro-bono. If you want to see Audiobookshelf in your language, please help us localize. Additional information on helping with the translations [here](https://www.audiobookshelf.org/faq#how-do-i-help-with-translations). <a href="https://hosted.weblate.org/engage/audiobookshelf/"> <img src="https://hosted.weblate.org/widget/audiobookshelf/abs-web-client/multi-auto.svg" alt="Translation status" /> </a>

<br />

# Run from source

This application is built using [NodeJs](https://nodejs.org/).

### Dev Container Setup

The easiest way to begin developing this project is to use a dev container. An introduction to dev containers in VSCode can be found [here](https://code.visualstudio.com/docs/devcontainers/containers).

Required Software:

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [VSCode](https://code.visualstudio.com/download)

_Note, it is possible to use other container software than Docker and IDEs other than VSCode. However, this setup is more complicated and not covered here._

<div>
<details>
<summary>Install the required software on Windows with <a href=(https://docs.microsoft.com/en-us/windows/package-manager/winget/#production-recommended)>winget</a></summary>

<p>
Note: This requires a PowerShell prompt with winget installed.  You should be able to copy and paste the code block to install.  If you use an elevated PowerShell prompt, UAC will not pop up during the installs.

```PowerShell
winget install -e --id Docker.DockerDesktop; `
winget install -e --id Microsoft.VisualStudioCode
```

</p>
</details>
</div>

<div>
<details>
<summary>Install the required software on MacOS with <a href=(https://snapcraft.io/)>homebrew</a></summary>

<p>

```sh
brew install --cask docker visual-studio-code
```

</p>
</details>
</div>

<div style="padding-bottom: 1em">
<details>
<summary>Install the required software on Linux with <a href=(https://brew.sh/)>snap</a></summary>

<p>

```sh
sudo snap install docker; \
sudo snap install code --classic
```

</p>
</details>
</div>

After installing these packages, you can now install the [Remote Development](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.vscode-remote-extensionpack) extension for VSCode. After installing this extension open the command pallet (`ctrl+shift+p` or `cmd+shift+p`) and select the command `>Dev Containers: Rebuild and Reopen in Container`. This will cause the development environment container to be built and launched.

You are now ready to start development!

### Manual Environment Setup

If you don't want to use the dev container, you can still develop this project. First, you will need to install [NodeJs](https://nodejs.org/) (version 24) and [FFmpeg](https://ffmpeg.org/).

Next you will need to create a `dev.js` file in the project's root directory. This contains configuration information and paths unique to your development environment. You can find an example of this file in `.devcontainer/dev.js`.

You are now ready to build the client:

```sh
npm ci
cd client
npm ci
npm run generate
cd ..
```

### Development Commands

After setting up your development environment, either using the dev container or using your own custom environment, the following commands will help you run the server and client.

To run the server, you can use the command `npm run dev`. This will compile the server and use the client that was built when you ran `npm run generate` in the client directory or when you started the dev container. Server changes are compiled and restarted automatically. If you make changes to the client, you will need to run the command `(cd client; npm run generate)` and then restart the server. By default the client runs at `localhost:3333`, though the port can be configured in `dev.js`.

You can also build a version of the client that supports live reloading. To do this, start the server, then run the command `(cd client; npm run dev)`. This will run a separate instance of the client at `localhost:3000` that will be automatically updated as you make changes to the client.

If you are using VSCode, this project includes a couple of pre-defined targets to speed up this process. First, if you build the project (`ctrl+shift+b` or `cmd+shift+b`) it will automatically generate the client. Next, there are debug commands for running the server and client. You can view these targets using the debug panel (bring it up with (`ctrl+shift+d` or `cmd+shift+d`):

- `Debug server`—Run the server.
- `Debug client (nuxt)`—Run the client with live reload.
- `Debug server and client (nuxt)`—Runs both the preceding two debug targets.
